import { existsSync, realpathSync, statSync } from "fs";
import { randomUUID } from "crypto";
import { homedir } from "os";
import { dirname, isAbsolute, join, parse, relative, resolve } from "path";
import { initBrain, planInit, type InitOptions, type InitPlan } from "../utils/init.js";

export interface BrainSetupInput {
  target_dir?: string;
  confirm?: boolean;
  preview_token?: string;
  minimal?: boolean;
  include_commands?: boolean;
  include_user_protocol?: boolean;
}

export interface BrainSetupEnv {
  // Workspace folders from MCP roots; null when the client doesn't support roots.
  roots: string[] | null;
  // Existing store if one already resolves, else null.
  existingBrainDir: string | null;
  // Called after a confirmed setup so the running server uses the new store.
  onCreated?: (brainDir: string) => void;
}

type PublicPlan = Omit<InitPlan, "targetDir" | "brainDir" | "storeExists" | "writePaths">;

export type BrainSetupResult =
  | { status: "already_set_up"; brain_dir: string; message: string }
  | { status: "needs_target"; roots: string[]; message: string }
  | { status: "rejected"; target_dir: string; reason: string }
  | {
      status: "needs_confirmation";
      target_dir: string;
      question: string;
      plan: PublicPlan;
      preview_token: string;
      next_step: string;
      note?: string;
    }
  | { status: "ready"; target_dir: string; brain_dir: string; report: string };

const PREVIEW_TTL_MS = 15 * 60 * 1000;

interface PendingPreview {
  target: string;
  fingerprint: string; // options + plan; any change between preview and confirm forces a new preview
  expires: number;
}

// Server-issued, single-use preview tokens. A write is only accepted for a
// token this process handed out for the same folder, options, and plan.
const pendingPreviews = new Map<string, PendingPreview>();

function isInside(child: string, parent: string): boolean {
  const rel = relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function realDir(p: string): string {
  return realpathSync(resolve(p));
}

// Resolve a not-yet-existing path through its nearest existing ancestor, so a
// symlinked parent (e.g. .claude -> /elsewhere) is followed to where writes land.
function realDestination(p: string): string {
  let probe = p;
  const tail: string[] = [];
  while (!existsSync(probe)) {
    const parent = dirname(probe);
    if (parent === probe) break;
    tail.unshift(relative(parent, probe));
    probe = parent;
  }
  return join(realpathSync(probe), ...tail);
}

// Folders a store must never be created in: filesystem root and the home folder itself.
function forbiddenReason(dir: string): string | null {
  if (dir === parse(dir).root) return "Refusing to set up Brain OS at the filesystem root.";
  if (dir === realDir(homedir())) {
    return "Refusing to set up Brain OS in the home folder itself. Pick a project folder.";
  }
  return null;
}

export async function setupBrain(input: BrainSetupInput, env: BrainSetupEnv): Promise<BrainSetupResult> {
  if (env.existingBrainDir) {
    return {
      status: "already_set_up",
      brain_dir: env.existingBrainDir,
      message: "Brain OS is already set up for this workspace. Nothing to do.",
    };
  }

  const roots = (env.roots ?? []).filter((root) => existsSync(root)).map(realDir);

  // Pick the folder to propose. An explicit target always wins; otherwise a
  // single workspace root is unambiguous. Several roots, or none, need the
  // user to name the folder.
  let requested: string;
  if (input.target_dir) {
    if (!isAbsolute(input.target_dir)) {
      return { status: "rejected", target_dir: input.target_dir, reason: "target_dir must be an absolute path." };
    }
    requested = resolve(input.target_dir);
  } else if (roots.length === 1) {
    requested = roots[0];
  } else {
    return {
      status: "needs_target",
      roots,
      message: roots.length > 1
        ? "Several workspace folders are open. Ask the user which one to set up, then call brain_setup with target_dir."
        : "The client did not report a workspace folder. Ask the user for the project folder, then call brain_setup with target_dir.",
    };
  }

  if (!existsSync(requested) || !statSync(requested).isDirectory()) {
    return { status: "rejected", target_dir: requested, reason: "target_dir does not exist or is not a folder." };
  }
  // Every check below runs on real paths: symlinks are followed to where writes would land.
  const target = realDir(requested);
  const forbidden = forbiddenReason(target);
  if (forbidden) return { status: "rejected", target_dir: target, reason: forbidden };
  if (roots.length > 0 && !roots.some((root) => isInside(target, root))) {
    return {
      status: "rejected",
      target_dir: target,
      reason: `target_dir resolves outside the open workspace folders (${roots.join(", ")}).`,
    };
  }

  const options: InitOptions = {
    withCommands: input.include_commands !== false,
    withAgentInstructions: true,
    minimal: input.minimal === true,
    withUserProtocol: input.include_user_protocol === true,
    surface: "mcp",
  };
  const fullPlan = planInit(target, options);
  const escaping = fullPlan.writePaths.filter((p) => !isInside(realDestination(p), target));
  if (escaping.length > 0) {
    return {
      status: "rejected",
      target_dir: target,
      reason: `These writes would land outside the project through a symlink: ${escaping
        .map((p) => relative(target, p))
        .join(", ")}. Remove or replace the links, then try again.`,
    };
  }
  const { targetDir: _t, brainDir: _b, storeExists: _s, writePaths: _w, ...plan } = fullPlan;
  const fingerprint = JSON.stringify({ options, plan });

  const now = Date.now();
  for (const [token, pending] of pendingPreviews) {
    if (pending.expires <= now) pendingPreviews.delete(token);
  }

  const preview = (note?: string): BrainSetupResult => {
    const token = randomUUID();
    pendingPreviews.set(token, { target, fingerprint, expires: now + PREVIEW_TTL_MS });
    return {
      status: "needs_confirmation",
      target_dir: target,
      question: `Set up Brain OS in ${target}?`,
      plan,
      preview_token: token,
      next_step:
        "Show the user the folder and the plan, and ask them to confirm. Only after they say yes, " +
        `call brain_setup again with confirm=true, target_dir="${target}", the same options, ` +
        `and preview_token="${token}". The token expires in 15 minutes and works once.`,
      ...(note ? { note } : {}),
    };
  };

  if (!input.confirm) return preview();

  // A write must match a preview this server issued for the same folder, options, and plan.
  const pending = input.preview_token ? pendingPreviews.get(input.preview_token) : undefined;
  if (!input.target_dir || !pending) {
    return preview("No valid preview_token: nothing was written. Show this preview to the user first.");
  }
  if (pending.target !== target || pending.fingerprint !== fingerprint) {
    pendingPreviews.delete(input.preview_token!);
    return preview("The folder, options, or files changed since the preview: nothing was written. Confirm this new preview.");
  }
  pendingPreviews.delete(input.preview_token!);

  const report = await initBrain(target, options);
  const brainDir = join(target, ".brain");
  env.onCreated?.(brainDir);
  return { status: "ready", target_dir: target, brain_dir: brainDir, report };
}
