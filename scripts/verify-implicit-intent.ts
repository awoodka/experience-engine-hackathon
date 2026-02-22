#!/usr/bin/env bun
/**
 * Gemini verification pass for the implicit-intent index.
 *
 * Samples entries across videos and skill levels, extracts clips,
 * and asks Gemini whether the claimed implicit intent is actually
 * visible in the footage.
 *
 * Usage:
 *   bun run scripts/verify-implicit-intent.ts                 — sample 10 entries
 *   bun run scripts/verify-implicit-intent.ts --sample 20     — sample 20 entries
 *   bun run scripts/verify-implicit-intent.ts --all           — verify every entry
 *   bun run scripts/verify-implicit-intent.ts 05_production_mp — one video only
 */

import { spawnSync } from "child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";

const ROOT = new URL("..", import.meta.url).pathname;
const ENTRIES_DIR = join(ROOT, "data/index/implicit-intent/entries");
const VIDEOS_DIR = join(ROOT, "data/videos");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ee(args: string[]): string {
  const result = spawnSync("./ee", args, {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`ee ${args.join(" ")} failed:\n${result.stderr}`);
  }
  return result.stdout.trim();
}

const MAX_CLIP_SECS = 25;

function extractClip(
  videoName: string,
  startSec: number,
  endSec: number,
): string {
  const videoPath = join(VIDEOS_DIR, videoName);
  if (!existsSync(videoPath)) {
    throw new Error(`Video not found: ${videoPath}`);
  }
  let s = Math.max(0, startSec - 1);
  let e = endSec + 1;
  if (e - s > MAX_CLIP_SECS) {
    const mid = (startSec + endSec) / 2;
    s = Math.max(0, mid - MAX_CLIP_SECS / 2);
    e = s + MAX_CLIP_SECS;
  }
  const raw = ee([
    "video-clip",
    videoPath,
    "--start",
    String(s),
    "--end",
    String(e),
  ]);
  return JSON.parse(raw).path;
}

interface VerifyResult {
  intentConfirmed: boolean;
  categoryAccurate: boolean;
  skillLevelPlausible: boolean;
  confidence: "high" | "medium" | "low";
  whatISee: string;
  issues: string;
}

const VERIFY_SCHEMA = JSON.stringify({
  type: "object",
  properties: {
    intentConfirmed: {
      type: "boolean",
      description:
        "True if the described implicit intent behavior is clearly visible in the clip. False if the clip shows something different or the behavior is not observable.",
    },
    categoryAccurate: {
      type: "boolean",
      description:
        "True if the assigned category (e.g. hesitation, coordination, smoothness, attention) accurately describes the primary behavioral pattern visible.",
    },
    skillLevelPlausible: {
      type: "boolean",
      description:
        "True if the claimed skill level (novice/developing/competent/proficient/expert) is plausible given what you observe. False if the worker is clearly at a different skill level.",
    },
    confidence: {
      type: "string",
      enum: ["high", "medium", "low"],
      description: "Your confidence in this verification.",
    },
    whatISee: {
      type: "string",
      description:
        "2-3 sentences describing exactly what you observe in the clip — the worker's actions, body movements, and behavioral patterns.",
    },
    issues: {
      type: "string",
      description:
        "If any field is false, explain what is wrong. If all fields are true, write 'none'.",
    },
  },
  required: [
    "intentConfirmed",
    "categoryAccurate",
    "skillLevelPlausible",
    "confidence",
    "whatISee",
    "issues",
  ],
});

function verifyEntry(
  clipPath: string,
  entry: Record<string, unknown>,
): VerifyResult {
  const prompt = `You are verifying an implicit intent annotation on a construction site video clip.

CLAIMED ANNOTATION:
- Category: ${entry.category}
- Skill level: ${entry.skillLevel} (score ${entry.intentScore}/100)
- Activity context: ${entry.activity}
- Task sequence: ${(entry.taskSet as string[]).join(" → ")}
- Description: ${entry.description}
- Reasoning: ${entry.reasoning ?? "N/A"}

Watch the clip carefully. Verify whether:
1. The described implicit intent behavior is actually visible (not inferred or imagined)
2. The category label accurately describes the primary behavioral pattern
3. The skill level assessment is plausible given what you observe

Be strict — the goal is to catch hallucinated or inaccurate annotations.
A "hesitation" should show actual pausing or uncertainty.
"Coordination" should show multi-worker interaction.
"Smoothness" should show fluid or interrupted workflow.
"Attention" should show checking, inspecting, or vigilance behavior.
An "expert" should show clearly skilled, efficient movements. A "novice" should show uncertainty or inefficiency.`;

  const raw = ee([
    "video-analyze",
    clipPath,
    prompt,
    "--schema",
    VERIFY_SCHEMA,
  ]);
  return JSON.parse(raw) as VerifyResult;
}

// ---------------------------------------------------------------------------
// Load and sample entries
// ---------------------------------------------------------------------------

interface IntentEntry {
  video: string;
  startSec: number;
  endSec: number;
  category: string;
  intentScore: number;
  skillLevel: string;
  description: string;
  activity: string;
  taskSet: string[];
  reasoning?: string;
  [key: string]: unknown;
}

const entryFiles = readdirSync(ENTRIES_DIR).filter((f) => f.endsWith(".json"));

const args = process.argv.slice(2);
const verifyAll = args.includes("--all");
const sampleFlag = args.find((a) => a === "--sample");
const sampleSize = sampleFlag
  ? parseInt(args[args.indexOf("--sample") + 1] || "10", 10)
  : 10;
const filterArg = args.find(
  (a) => !a.startsWith("--") && a !== String(sampleSize),
);

const filesToProcess = filterArg
  ? entryFiles.filter((f) => f.includes(filterArg))
  : entryFiles;

// Collect all entries with their source file
const allEntries: { file: string; index: number; entry: IntentEntry }[] = [];
for (const file of filesToProcess) {
  const entries = JSON.parse(
    readFileSync(join(ENTRIES_DIR, file), "utf8"),
  ) as IntentEntry[];
  for (let i = 0; i < entries.length; i++) {
    allEntries.push({ file, index: i, entry: entries[i] });
  }
}

// Sample: stratify by skill level for coverage across the distribution
let toVerify: typeof allEntries;
if (verifyAll) {
  toVerify = allEntries;
} else {
  const bySkill = new Map<string, typeof allEntries>();
  for (const e of allEntries) {
    const level = e.entry.skillLevel;
    if (!bySkill.has(level)) bySkill.set(level, []);
    bySkill.get(level)!.push(e);
  }

  toVerify = [];
  const levels = [...bySkill.keys()];
  const perLevel = Math.max(1, Math.ceil(sampleSize / levels.length));

  for (const level of levels) {
    const pool = bySkill.get(level)!;
    // Shuffle
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    toVerify.push(...pool.slice(0, perLevel));
  }

  // Trim to exact sample size
  toVerify = toVerify.slice(0, sampleSize);
}

console.log(
  `\nVerifying ${toVerify.length} of ${allEntries.length} implicit intent entries with Gemini...\n`,
);

// ---------------------------------------------------------------------------
// Verify
// ---------------------------------------------------------------------------

let passed = 0;
let failed = 0;
let skipped = 0;
const failures: {
  file: string;
  index: number;
  entry: IntentEntry;
  result: VerifyResult;
}[] = [];

for (const { file, index, entry } of toVerify) {
  const label = `${file}[${index}] ${entry.category} ${entry.startSec}-${entry.endSec}s (${entry.skillLevel})`;
  process.stdout.write(`  ${label} ... `);

  let clipPath: string;
  try {
    clipPath = extractClip(entry.video, entry.startSec, entry.endSec);
  } catch (e) {
    console.log(`SKIP (clip failed: ${e})`);
    skipped++;
    continue;
  }

  // Skip tiny clips
  const clipStat = statSync(clipPath);
  if (clipStat.size < 10_000) {
    console.log(`SKIP (clip too small: ${clipStat.size} bytes)`);
    skipped++;
    continue;
  }

  try {
    const result = verifyEntry(clipPath, entry);
    const allOk =
      result.intentConfirmed &&
      result.categoryAccurate &&
      result.skillLevelPlausible;

    if (allOk) {
      passed++;
      console.log(`PASS (${result.confidence})`);
    } else {
      failed++;
      failures.push({ file, index, entry, result });
      const flags = [
        !result.intentConfirmed && "intent",
        !result.categoryAccurate && "category",
        !result.skillLevelPlausible && "skill",
      ]
        .filter(Boolean)
        .join(", ");
      console.log(`FAIL [${flags}] (${result.confidence})`);
      console.log(`    See: ${result.whatISee}`);
      console.log(`    Issues: ${result.issues}`);
    }
  } catch (e) {
    console.log(`ERROR: ${e}`);
    skipped++;
  }
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

console.log(`\n--- Verification Summary ---`);
console.log(`Passed: ${passed}/${toVerify.length}`);
console.log(`Failed: ${failed}/${toVerify.length}`);
console.log(`Skipped: ${skipped}/${toVerify.length}`);

if (passed + failed > 0) {
  const accuracy = ((passed / (passed + failed)) * 100).toFixed(1);
  console.log(`Accuracy: ${accuracy}%`);
}

if (failures.length > 0) {
  console.log(`\n--- Failures ---`);
  for (const f of failures) {
    console.log(`\n  ${f.file}[${f.index}]:`);
    console.log(
      `    Claimed: ${f.entry.category} / ${f.entry.skillLevel} / score ${f.entry.intentScore}`,
    );
    console.log(`    Activity: ${f.entry.activity}`);
    console.log(`    Gemini sees: ${f.result.whatISee}`);
    console.log(`    Issues: ${f.result.issues}`);
  }
}

console.log(`\nDone.`);
