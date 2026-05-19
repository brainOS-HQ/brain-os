#!/usr/bin/env python3
"""
Brain OS routing guard — PreToolUse hook.

Soft warning when Claude reads a pulse file while a .brain/ workspace exists.
Encourages routing through mcp__brain-os__* tools instead.

Behavior: prints a warning to stderr but does NOT block. The model sees the
warning in the next turn and can self-correct without breaking valid escape
cases.

Install (opt-in): add to ~/.claude/settings.json or .claude/settings.local.json:

  {
    "hooks": {
      "PreToolUse": [
        {
          "matcher": "Read",
          "hooks": [
            {
              "type": "command",
              "command": "python3 ~/.claude/hooks/brain-os-routing-guard.py"
            }
          ]
        }
      ]
    }
  }
"""

import json
import os
import sys
from pathlib import Path


PULSE_PATH_MARKERS = ("/memory/", "-pulse.md", "brain-pulse", "/brain/decision-log", "/brain/pattern-log")


def is_pulse_file_path(path: str) -> bool:
    """Return True if the path looks like a Brain-OS pulse / legacy memory file."""
    if not path:
        return False
    p = path.lower()
    return any(marker in p for marker in PULSE_PATH_MARKERS)


def brain_os_workspace_exists(cwd: str) -> bool:
    """Walk up from cwd looking for a `.brain/` directory."""
    current = Path(cwd).resolve()
    for parent in [current, *current.parents]:
        if (parent / ".brain").is_dir():
            return True
    return False


def main() -> int:
    try:
        payload = json.load(sys.stdin)
    except json.JSONDecodeError:
        # No payload, no opinion.
        return 0

    tool_name = payload.get("tool_name", "")
    if tool_name != "Read":
        return 0

    tool_input = payload.get("tool_input", {}) or {}
    file_path = tool_input.get("file_path") or tool_input.get("path") or ""

    if not is_pulse_file_path(file_path):
        return 0

    cwd = payload.get("cwd") or os.getcwd()
    if not brain_os_workspace_exists(cwd):
        # No .brain/ here — pulse files are the legitimate source. Stay silent.
        return 0

    # .brain/ exists AND Claude is reading a pulse file. Warn.
    warning = (
        "Brain OS routing guard: you read a pulse / legacy memory file "
        f"({file_path}), but a `.brain/` workspace exists at or above {cwd}. "
        "Pulse files drift. Prefer the live MCP tools: "
        "mcp__brain-os__entity_read, plan_read, focus_get, semantic_recall. "
        "See ~/.claude/brain-os/PROTOCOL.md."
    )
    print(warning, file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
