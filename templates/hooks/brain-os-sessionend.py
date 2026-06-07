#!/usr/bin/env python3
"""
SessionEnd hook: saves an unconfirmed checkpoint when a session ends.

Writes to: <brain_dir>/sessions/checkpoints/<session_id>-<timestamp>.json

Companion to brain-os-precompact.py. PreCompact catches "context is about to be
summarized"; SessionEnd catches "the user closed the terminal / ran /clear before
wrapping" — the other way session state silently disappears.

Self-contained by design: it does NOT import the precompact hook, so installing
one never breaks the other. Best-effort only, never blocks, exits 0 always.

Unlike PreCompact (which always captures), SessionEnd only writes a checkpoint
when the session did real work (touched a Brain OS entity or edited files) —
otherwise every trivial session-end would litter the checkpoint dir.

Install (opt-in): add to ~/.claude/settings.json or .claude/settings.local.json:

  {
    "hooks": {
      "SessionEnd": [
        {
          "hooks": [
            {
              "type": "command",
              "command": "python3 ~/.claude/hooks/brain-os-sessionend.py"
            }
          ]
        }
      ]
    }
  }

Design for Brain OS "Auto-wrap" feature:
  - Auto-save = captured/unconfirmed
  - /start surfaces it next session; /wrap confirms or discards
  - Stale checkpoints are never treated as truth
"""

import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

BRAIN_DIRS = [
    Path.home() / ".brain",
]

PROJECT_MARKERS = ("AI projects", "AI project")


def find_brain_dir(cwd: str):
    """Find .brain/ directory: check cwd ancestors, then home."""
    if cwd:
        p = Path(cwd)
        for ancestor in [p, *p.parents]:
            candidate = ancestor / ".brain"
            if candidate.is_dir():
                return candidate
    for d in BRAIN_DIRS:
        if d.is_dir():
            return d
    return None


def detect_folder_slug(cwd: str):
    """Detect project folder slug from cwd path."""
    if not cwd:
        return None
    parts = Path(cwd).parts
    for marker in PROJECT_MARKERS:
        if marker in parts:
            idx = parts.index(marker)
            if idx + 1 < len(parts):
                return parts[idx + 1]
    return None


def resolve_entity_id(folder_slug, brain_dir):
    """Map a folder slug to the actual Brain OS entity ID (best-effort)."""
    if not folder_slug:
        return None
    if not brain_dir:
        return folder_slug

    entities_dir = brain_dir / "entities"
    if not entities_dir.is_dir():
        return folder_slug

    exact = entities_dir / f"{folder_slug}.json"
    if exact.exists():
        return folder_slug

    slug_lower = folder_slug.lower()
    candidates = []
    for entity_file in entities_dir.glob("*.json"):
        try:
            data = json.loads(entity_file.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            continue
        eid = data.get("id", "")
        name = (data.get("name") or "").lower().replace(" ", "-")
        if name == slug_lower:
            return eid
        if slug_lower in name:
            candidates.append((len(name), eid))
        related = data.get("related_entities") or []
        if folder_slug in related:
            candidates.append((100, eid))

    if candidates:
        candidates.sort()
        return candidates[0][1]

    return folder_slug


def extract_recent_context(transcript_path: str, max_exchanges: int = 10) -> dict:
    """Extract lightweight context from the end of the transcript."""
    result = {
        "last_user_goals": [],
        "files_touched": set(),
        "entity_mentions": set(),
        "open_questions": [],
        "last_assistant_text": "",
    }

    if not transcript_path or not Path(transcript_path).exists():
        return _serialize_sets(result)

    exchanges = []
    try:
        with open(transcript_path, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    entry = json.loads(line)
                except json.JSONDecodeError:
                    continue

                msg = entry.get("message") or entry.get("payload") or {}
                role = msg.get("role")
                content = msg.get("content")

                if role == "user" and content:
                    text = _extract_text(content)
                    if text:
                        exchanges.append({"role": "user", "text": text})
                elif role == "assistant" and content:
                    text = _extract_text(content)
                    if text:
                        exchanges.append({"role": "assistant", "text": text})
                    _collect_tool_info(content, result)
    except OSError:
        return _serialize_sets(result)

    recent = exchanges[-max_exchanges:]

    noise_prefixes = ("<turn_aborted>", "<system-reminder>", "<command-message>")
    for ex in recent:
        if ex["role"] == "user":
            text = ex["text"][:500].strip()
            if not text or text in result["last_user_goals"]:
                continue
            if any(text.startswith(p) for p in noise_prefixes):
                continue
            result["last_user_goals"].append(text)

    for ex in reversed(recent):
        if ex["role"] == "assistant" and ex["text"]:
            result["last_assistant_text"] = ex["text"][:500]
            break

    for ex in recent:
        text = ex["text"].lower()
        if "?" in text and ex["role"] == "assistant":
            for sentence in text.split("?"):
                sentence = sentence.strip()
                if len(sentence) > 15 and len(sentence) < 200:
                    result["open_questions"].append(sentence + "?")

    result["open_questions"] = result["open_questions"][-5:]
    result["last_user_goals"] = result["last_user_goals"][-5:]

    return _serialize_sets(result)


def _extract_text(content) -> str:
    if isinstance(content, str):
        return content.strip()
    if isinstance(content, list):
        text_types = ("text", "input_text", "output_text")
        chunks = []
        for block in content:
            if isinstance(block, dict) and block.get("type") in text_types:
                chunks.append(block.get("text", ""))
            elif isinstance(block, str):
                chunks.append(block)
        return "\n".join(c for c in chunks if c).strip()
    return ""


def _collect_tool_info(content, result: dict):
    """Extract file paths and entity references from tool_use blocks."""
    if not isinstance(content, list):
        return
    file_tools = {"Read", "Edit", "Write", "NotebookEdit", "MultiEdit"}
    brain_tools = {
        "mcp__brain-os__entity_read",
        "mcp__brain-os__entity_update",
        "mcp__brain-os__plan_read",
        "mcp__brain-os__plan_update",
        "mcp__brain-os__decision_log",
        "mcp__brain-os__decision_check",
        "mcp__brain-os__focus_get",
    }

    for block in content:
        if not isinstance(block, dict) or block.get("type") != "tool_use":
            continue
        name = block.get("name", "")
        inp = block.get("input") or {}

        if name in file_tools:
            path = inp.get("file_path") or inp.get("notebook_path")
            if path:
                result["files_touched"].add(path)

        if name in brain_tools:
            eid = inp.get("entity_id")
            if eid:
                result["entity_mentions"].add(eid)


def _serialize_sets(d: dict) -> dict:
    return {k: sorted(v) if isinstance(v, set) else v for k, v in d.items()}


def _did_real_work(context: dict) -> bool:
    """Only checkpoint a session that actually changed or examined state.

    A session that ended without touching a Brain OS entity, editing a file, or
    even stating a goal has nothing worth a checkpoint — skip it to avoid litter.
    """
    return bool(
        context.get("entity_mentions")
        or context.get("files_touched")
        or context.get("last_user_goals")
    )


def main() -> int:
    try:
        payload = json.load(sys.stdin)
    except (json.JSONDecodeError, ValueError):
        return 0

    session_id = payload.get("session_id", "unknown")
    transcript_path = payload.get("transcript_path", "")
    cwd = payload.get("cwd", "")
    # SessionEnd payloads carry `reason` (clear / logout / prompt_input_exit / other)
    reason = payload.get("reason", "unknown")

    brain_dir = find_brain_dir(cwd)
    if not brain_dir:
        return 0

    context = extract_recent_context(transcript_path)
    if not _did_real_work(context):
        return 0

    checkpoint_dir = brain_dir / "sessions" / "checkpoints"
    checkpoint_dir.mkdir(parents=True, exist_ok=True)

    now = datetime.now(timezone.utc)
    ts = now.strftime("%Y%m%dT%H%M%SZ")
    folder_slug = detect_folder_slug(cwd)
    entity_id = resolve_entity_id(folder_slug, brain_dir)

    checkpoint = {
        "type": "compact_checkpoint",
        "status": "captured",
        "confirmed": False,
        "source": "sessionend",
        "trigger": reason,
        "session_id": session_id,
        "cwd": cwd,
        "entity_id": entity_id,
        "folder_slug": folder_slug,
        "created_at": now.isoformat(),
        "last_user_goals": context["last_user_goals"],
        "files_touched": context["files_touched"],
        "entity_mentions": context["entity_mentions"],
        "open_questions": context["open_questions"],
        "last_assistant_summary": context["last_assistant_text"],
    }

    safe_session_id = re.sub(r"[^a-zA-Z0-9_\-]", "_", session_id)[:64]
    filename = f"{safe_session_id}-{ts}.json"
    try:
        (checkpoint_dir / filename).write_text(
            json.dumps(checkpoint, indent=2, ensure_ascii=False),
            encoding="utf-8",
        )
    except OSError:
        pass

    return 0


if __name__ == "__main__":
    sys.exit(main())
