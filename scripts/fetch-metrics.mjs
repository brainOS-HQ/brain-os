#!/usr/bin/env node
// Fetch npm + GitHub metrics for brain-os and write a daily snapshot.
//
// Outputs:
//   .brain/metrics/snapshot-YYYY-MM-DD.json   (overwrites if re-run same day)
//   .brain/metrics/timeline.jsonl              (appends one line per run)
//
// Usage:
//   node scripts/fetch-metrics.mjs
//   npm run metrics
//
// Schedule daily via launchd, cron, or a Claude /schedule routine.

import { writeFile, appendFile, mkdir } from "fs/promises";
import { join } from "path";
import { existsSync } from "fs";
import { spawnSync } from "child_process";

const PACKAGE = "brain-os";
const REPO = "brainOS-HQ/brain-os";
const BRAIN_DIR = process.env.BRAIN_DIR || join(process.cwd(), ".brain");
const METRICS_DIR = join(BRAIN_DIR, "metrics");

const today = new Date().toISOString().slice(0, 10);

function lastNDays(n) {
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - n);
  return {
    start: start.toISOString().slice(0, 10),
    end: end.toISOString().slice(0, 10),
  };
}

async function fetchJson(url) {
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`${url} → ${res.status}`);
  return res.json();
}

function fetchGhApi(path) {
  const result = spawnSync("gh", ["api", path], { encoding: "utf-8" });
  if (result.status !== 0) {
    return { error: result.stderr?.trim() || "gh CLI failed", available: false };
  }
  try {
    return { ...JSON.parse(result.stdout), available: true };
  } catch (e) {
    return { error: `parse failed: ${e.message}`, available: false };
  }
}

async function main() {
  await mkdir(METRICS_DIR, { recursive: true });

  const { start: weekStart, end: weekEnd } = lastNDays(7);
  const { start: monthStart, end: monthEnd } = lastNDays(30);

  console.log(`Fetching metrics for ${PACKAGE}...`);

  const [weekly, monthly] = await Promise.all([
    fetchJson(`https://api.npmjs.org/downloads/range/${weekStart}:${weekEnd}/${PACKAGE}`),
    fetchJson(`https://api.npmjs.org/downloads/range/${monthStart}:${monthEnd}/${PACKAGE}`),
  ]);

  const weeklyTotal = weekly.downloads.reduce((sum, d) => sum + d.downloads, 0);
  const monthlyTotal = monthly.downloads.reduce((sum, d) => sum + d.downloads, 0);

  const clones = fetchGhApi(`repos/${REPO}/traffic/clones`);
  const views = fetchGhApi(`repos/${REPO}/traffic/views`);

  const snapshot = {
    date: today,
    fetched_at: new Date().toISOString(),
    package: PACKAGE,
    repo: REPO,
    npm: {
      weekly_downloads: weeklyTotal,
      monthly_downloads: monthlyTotal,
      weekly_daily: weekly.downloads,
      monthly_daily: monthly.downloads,
    },
    github: {
      clones: clones.available
        ? { total: clones.count, uniques: clones.uniques, daily: clones.clones }
        : { error: clones.error },
      views: views.available
        ? { total: views.count, uniques: views.uniques, daily: views.views }
        : { error: views.error },
    },
  };

  const snapshotPath = join(METRICS_DIR, `snapshot-${today}.json`);
  await writeFile(snapshotPath, JSON.stringify(snapshot, null, 2));

  const timelinePath = join(METRICS_DIR, "timeline.jsonl");
  const timelineEntry = {
    date: today,
    fetched_at: snapshot.fetched_at,
    npm_weekly: weeklyTotal,
    npm_monthly: monthlyTotal,
    gh_clones_14d: clones.available ? clones.count : null,
    gh_clones_uniques_14d: clones.available ? clones.uniques : null,
    gh_views_14d: views.available ? views.count : null,
    gh_views_uniques_14d: views.available ? views.uniques : null,
  };
  await appendFile(timelinePath, JSON.stringify(timelineEntry) + "\n");

  console.log("");
  console.log(`Snapshot: ${snapshotPath}`);
  console.log("");
  console.log("Summary");
  console.log(`  npm downloads (7d):    ${weeklyTotal.toLocaleString()}`);
  console.log(`  npm downloads (30d):   ${monthlyTotal.toLocaleString()}`);
  if (clones.available) {
    console.log(`  GH clones (14d):       ${clones.count} (${clones.uniques} unique)`);
  } else {
    console.log(`  GH clones (14d):       unavailable (${clones.error})`);
  }
  if (views.available) {
    console.log(`  GH views (14d):        ${views.count} (${views.uniques} unique)`);
  } else {
    console.log(`  GH views (14d):        unavailable (${views.error})`);
  }
  console.log("");
  console.log(`Timeline appended: ${timelinePath}`);
}

main().catch((err) => {
  console.error(`Failed: ${err.message}`);
  process.exit(1);
});
