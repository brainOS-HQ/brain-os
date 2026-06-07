#!/usr/bin/env node
/**
 * Brain OS privacy / secret gate — deny-by-default.
 *
 * Blocks private data and secrets from reaching public surfaces (git push,
 * npm publish). Runs in CI (not just bypassable local hooks) and as
 * prepublishOnly.
 *
 * Checks, over either tracked files (`--git`) or the npm tarball (`--pack`):
 *   1. PRIVATE PATHS  — known-private file types must never be public.
 *   2. NPM ALLOWLIST  — the package may only ship src/dist/templates/bin/docs.
 *   3. SECRETS        — secret-shaped strings (keys, tokens, private keys).
 *   4. NAME DENYLIST  — optional: real project/owner names. Loaded from a
 *      gitignored `.privacy-denylist` file or the PRIVACY_DENYLIST env var
 *      (e.g. a CI secret), so the names themselves never live in the public repo.
 *
 * Exit 0 = clean. Exit 1 = leak found (fails the build).
 *
 * Usage:
 *   node scripts/privacy-scan.mjs --git     # scan tracked files (CI / pre-push)
 *   node scripts/privacy-scan.mjs --pack    # scan npm tarball (prepublishOnly)
 */

import { execSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const MODE = process.argv.includes("--pack") ? "pack" : "git";

// 1. Private file paths — deny by default. These never belong on public.
const PRIVATE_PATHS = [
  /(^|\/)\.brain(\/|$)/,
  /(^|\/)\.env($|\.)/,           // .env, .env.local (allow .env.example)
  /(^|\/)drafts\//,
  /(^|\/)STATE\.md$/,
  /(^|\/)HANDOFF[^/]*\.md$/i,
  /(^|\/)STRATEGY\.md$/,
  /(^|\/)YC[_-][^/]*$/i,
  /(^|\/)codebase-map\.md$/,
  /(^|\/)\.codex\//,
  /(^|\/)__pycache__\//,
];

// 2. npm tarball allowlist — only these top-level entries may ship.
const NPM_ALLOWED_TOP = new Set(["dist", "bin", "templates", "README.md", "LICENSE", "package.json"]);

// 3. Secret-shaped strings (high-confidence). Env references are NOT secrets.
const SECRET_PATTERNS = [
  { name: "OpenAI/Anthropic key", re: /\b(sk|sk-ant)-[A-Za-z0-9_-]{20,}/ },
  { name: "Resend key", re: /\bre_[A-Za-z0-9_-]{16,}/ },
  { name: "GitHub token", re: /\bgh[pousr]_[A-Za-z0-9]{20,}/ },
  { name: "AWS access key", re: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: "Slack token", re: /\bxox[abpos]-[A-Za-z0-9-]{10,}/ },
  { name: "Private key block", re: /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/ },
  { name: "Brain OS API key", re: /\bbos_[A-Za-z0-9]{24,}/ },
  { name: "Hardcoded secret assignment", re: /(client_secret|api[_-]?key|password|secret_key)\s*[:=]\s*["'][^"'\s$]{12,}["']/i },
];

// 4. Optional name denylist (kept OUT of the public repo).
function loadNameDenylist() {
  const raw = process.env.PRIVACY_DENYLIST
    ? process.env.PRIVACY_DENYLIST
    : existsSync(".privacy-denylist")
      ? readFileSync(".privacy-denylist", "utf-8")
      : "";
  return raw
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter((s) => s && !s.startsWith("#"));
}

// Env-reference guard: skip lines that only READ a secret from the environment.
const ENV_REF = /(process\.env|c\.env\.|env\.[A-Z_]+|\$\{?[A-Z_]+\}?|import\.meta\.env)/;

function listFiles() {
  if (MODE === "pack") {
    const out = execSync("npm pack --dry-run --json", { encoding: "utf-8" });
    const files = JSON.parse(out)[0].files.map((f) => f.path);
    return { files, label: "npm tarball" };
  }
  const out = execSync("git ls-files", { encoding: "utf-8" });
  return { files: out.split("\n").filter(Boolean), label: "tracked files" };
}

function isTextFile(path) {
  return !/\.(png|jpe?g|gif|webp|ico|pdf|zip|gz|tgz|woff2?|ttf|otf|mp4|mov)$/i.test(path);
}

const { files, label } = listFiles();
const names = loadNameDenylist();
const findings = [];

// 2. npm allowlist (pack mode only)
if (MODE === "pack") {
  for (const f of files) {
    const top = f.split("/")[0];
    if (!NPM_ALLOWED_TOP.has(top)) {
      findings.push({ kind: "NOT-ALLOWLISTED", path: f, detail: `top-level "${top}" not in npm allowlist` });
    }
  }
}

for (const path of files) {
  // 1. private paths
  for (const re of PRIVATE_PATHS) {
    if (re.test(path)) findings.push({ kind: "PRIVATE-PATH", path, detail: `matches ${re}` });
  }

  // 3 + 4. content scan (text files only; tarball paths may have a package/ prefix)
  if (!isTextFile(path)) continue;
  const fsPath = MODE === "pack" ? path.replace(/^package\//, "") : path;
  let content;
  try {
    content = readFileSync(fsPath, "utf-8");
  } catch {
    continue;
  }
  const lines = content.split("\n");
  lines.forEach((line, i) => {
    for (const { name, re } of SECRET_PATTERNS) {
      if (re.test(line) && !ENV_REF.test(line)) {
        findings.push({ kind: "SECRET", path, detail: `${name} @ line ${i + 1}` });
      }
    }
    for (const n of names) {
      if (line.toLowerCase().includes(n.toLowerCase())) {
        findings.push({ kind: "PRIVATE-NAME", path, detail: `"${n}" @ line ${i + 1}` });
      }
    }
  });
}

if (findings.length === 0) {
  console.log(`✓ privacy-scan (${label}): clean — no private paths, secrets, or denied names.`);
  if (names.length === 0) {
    console.log("  note: no name denylist loaded (.privacy-denylist / PRIVACY_DENYLIST). Path + secret checks ran.");
  }
  process.exit(0);
}

console.error(`\n✗ privacy-scan (${label}): ${findings.length} finding(s) — blocking public action.\n`);
for (const f of findings) {
  console.error(`  [${f.kind}] ${f.path}  — ${f.detail}`);
}
console.error("\nRemediation: remove/genericize the above, or add a deliberate exception. Do not push/publish until clean.\n");
process.exit(1);
