#!/usr/bin/env bun
/**
 * Backfills all behavioral index entries with spatialIntelligence blocks
 * and updates reasoning to 3+ sentences mixing behavioral + spatial signals.
 *
 * For each implicitIntent that lacks spatialIntelligence:
 *   1. Extract a clip at the intent's timestamps
 *   2. Run Gemini spatial analysis on the clip
 *   3. Ask Gemini to rewrite the reasoning to 3+ sentences
 *   4. Write the enriched entry back
 */

import { spawnSync } from "child_process";
import { readFileSync, existsSync } from "fs";
import { join } from "path";

const ROOT = new URL("..", import.meta.url).pathname;
const ENTRIES_DIR = join(ROOT, "data/index/behavioral/entries");
const DATA_DIR = join(ROOT, "data");

const SPATIAL_SCHEMA = JSON.stringify({
  type: "object",
  properties: {
    bodyOrientation: {
      type: "object",
      properties: {
        label: { type: "string" },
        observation: { type: "string" },
        expertSignal: { type: "boolean" },
      },
      required: ["label", "observation", "expertSignal"],
    },
    distanceBeforeAction: {
      type: "object",
      properties: {
        label: { type: "string" },
        estimatedMeters: { type: "number" },
        observation: { type: "string" },
        expertSignal: { type: "boolean" },
      },
      required: ["label", "estimatedMeters", "observation", "expertSignal"],
    },
    trajectoryEfficiency: {
      type: "object",
      properties: {
        label: { type: "string" },
        efficiencyRatio: { type: "number" },
        observation: { type: "string" },
        expertSignal: { type: "boolean" },
      },
      required: ["label", "efficiencyRatio", "observation", "expertSignal"],
    },
  },
  required: ["bodyOrientation", "distanceBeforeAction", "trajectoryEfficiency"],
});

const REASONING_SCHEMA = JSON.stringify({
  type: "object",
  properties: {
    reasoning: { type: "string" },
  },
  required: ["reasoning"],
});

const SPATIAL_PROMPT = `You are a construction site expert evaluating a worker's spatial behavior in this video clip.
Analyze three dimensions and for each one: describe exactly what you observe AND decide if it is an expert or novice signal.

EXPERT vs NOVICE reference for each dimension:

BODY ORIENTATION
  Expert: turns to face the object before acting, squares hips/shoulders to the load before lifting,
          scans the area before moving, leans in deliberately for precision work, retreats to create
          clearance before a hazardous action.
  Novice: moves without first orienting to the target, faces the wrong direction during action,
          has to twist or adjust body mid-task, awkward angle that reduces control or visibility.
Choose one label: face_target_before_act | square_up_before_lift | lean_in_for_precision |
  angled_away_from_target | overhead_extension | crouch_low_position | scan_before_move |
  pivot_to_partner | brace_against_surface | retreat_for_clearance
Set expertSignal=true if the orientation shows deliberate setup before action; false if the worker
is poorly oriented or has to correct mid-task.

DISTANCE BEFORE ACTION
  Expert: steps deliberately close before cutting (< 0.4m), keeps a safe distance before a lift
          or overhead hazard, repositions until they find a comfortable stance before committing.
  Novice: acts at arm's full extension without stepping closer (overreach), closes distance too
          fast and overshoots, makes multiple awkward adjustments after already starting the action.
Estimate the distance in meters between the worker and the work surface at action initiation.
Choose one label: close_gap_before_cut | close_gap_before_install | close_gap_before_braze |
  maintain_safe_distance | overreach_no_reposition | reposition_until_comfortable |
  consistent_working_distance | variable_working_distance
Set expertSignal=true if the distance and approach show deliberate, controlled positioning;
false if the worker overreaches, overshoots, or adjusts awkwardly after starting.

TRAJECTORY EFFICIENCY
  Expert: moves in a direct line to the target, uses a stationary pivot when repositioning within
          reach, takes the shortest route between work points with no wasted steps.
  Novice: wanders before reaching the target, backtracks, takes wide arcs, makes multiple approach
          attempts, searches without a clear destination.
Estimate efficiencyRatio = straight-line distance / actual path distance (1.0 = perfectly direct).
Choose one label: direct_path | minor_deviation | significant_deviation | search_pattern |
  stationary_pivot | backtrack_detected | parallel_approach
Set expertSignal=true if movement is direct and purposeful; false if the worker wanders,
backtracks, or searches.

For each dimension write ONE concrete sentence of what you literally observe.
Cite specific values: approximate body angle, distance in meters, number of extra steps or reversals.`;

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
  const videoPath = join(DATA_DIR, videoName);
  if (!existsSync(videoPath)) {
    throw new Error(`Video not found: ${videoPath}`);
  }
  // Cap clip at MAX_CLIP_SECS centered on the midpoint
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
  const result = JSON.parse(raw);
  return result.path;
}

function analyzeSpatial(clipPath: string): object | null {
  try {
    const raw = ee([
      "video-analyze",
      clipPath,
      SPATIAL_PROMPT,
      "--schema",
      SPATIAL_SCHEMA,
    ]);
    return JSON.parse(raw);
  } catch (e) {
    console.warn(`  ⚠ Spatial analysis failed: ${e}`);
    return null;
  }
}

function rewriteReasoning(
  clipPath: string,
  activity: string,
  category: string,
  taskSet: string[],
  existingReasoning: string,
  spatial: Record<
    string,
    {
      label: string;
      observation: string;
      expertSignal: boolean;
      estimatedMeters?: number;
      efficiencyRatio?: number;
    }
  >,
  score: number,
): string {
  const expertCount = Object.values(spatial).filter(
    (d) => d.expertSignal,
  ).length;
  const noviceCount = Object.values(spatial).filter(
    (d) => !d.expertSignal,
  ).length;
  const overallVerdict =
    score >= 80
      ? "This worker is performing at an expert level."
      : score >= 60
        ? "This worker is competent but has a specific gap in technique."
        : "This worker is showing novice behavior with a clear problem that needs correction.";

  const spatialSummary = Object.entries(spatial)
    .map(([dim, d]) => {
      const signal = d.expertSignal ? "EXPERT signal" : "NOVICE signal";
      const extra =
        dim === "distanceBeforeAction" && d.estimatedMeters != null
          ? ` (${d.estimatedMeters}m)`
          : dim === "trajectoryEfficiency" && d.efficiencyRatio != null
            ? ` (ratio: ${d.efficiencyRatio})`
            : "";
      return `  ${dim} [${d.label}${extra}] → ${signal}: ${d.observation}`;
    })
    .join("\n");

  const prompt = `You are writing a training evaluation note for a construction worker based on video evidence.

Activity: "${activity}"
Behavioral category: ${category} | Task sequence: ${taskSet.join(" → ")} | Score: ${score}/100
Overall verdict: ${overallVerdict}

Spatial signals observed (${expertCount} expert, ${noviceCount} novice out of 3 dimensions):
${spatialSummary}

Prior behavioral reasoning: "${existingReasoning}"

Write a new reasoning string of EXACTLY 3 sentences:

Sentence 1 — BEHAVIORAL: Describe what the task sequence (${taskSet.join(" → ")}) reveals.
  State clearly whether this pattern shows expertise (deliberate, efficient) or a problem
  (hesitation, rework, poor timing, missed check). Be direct — name what is happening.

Sentence 2 — SPATIAL: Describe what the spatial signals show about the worker's physical technique.
  For each dimension that has a NOVICE signal, state specifically what they did wrong and what
  an expert would do instead (e.g. "stepped to 0.9m instead of closing to 0.3m before cutting,
  reducing control" or "approached at an angle rather than squaring to the load").
  For EXPERT signals, briefly confirm what they did right (e.g. "closed to 0.2m before brazing,
  maintaining precise flame distance"). ALWAYS cite the actual number (meters or ratio).

Sentence 3 — VERDICT: Give a one-sentence summary of the worker's skill level for this action.
  If novice signals dominate: state exactly what the worker must do differently next time.
  If expert signals dominate: state what makes this technique correct and worth repeating.
  If mixed: acknowledge what works and what the single most important fix is.

Rules:
- Be literal and specific — no metaphors, no vague praise
- Never call a worker "expert" or "advanced" when novice signals dominate or score < 60
- Never call a worker "novice" when expert signals dominate and score > 79
- Always cite at least one number from the spatial data
- Write as connected prose sentences, not bullet points`;

  try {
    const raw = ee([
      "video-analyze",
      clipPath,
      prompt,
      "--schema",
      REASONING_SCHEMA,
    ]);
    const result = JSON.parse(raw);
    return result.reasoning;
  } catch (e) {
    console.warn(`  ⚠ Reasoning rewrite failed: ${e}`);
    return existingReasoning;
  }
}

async function processEntry(filename: string, force = false): Promise<void> {
  const entryPath = join(ENTRIES_DIR, filename);
  const entry = JSON.parse(readFileSync(entryPath, "utf8"));
  const videoName = entry.videoName as string;
  let changed = false;

  console.log(`\n📹 ${videoName}`);

  for (const seg of entry.segments) {
    if (!seg.implicitIntents || seg.implicitIntents.length === 0) continue;

    for (const intent of seg.implicitIntents) {
      if (intent.spatialIntelligence && !force) {
        console.log(
          `  ✓ seg ${seg.segmentIndex} [${intent.category}] already enriched — skipping`,
        );
        continue;
      }

      console.log(
        `  → seg ${seg.segmentIndex} [${intent.category}] ${intent.startSec}–${intent.endSec}s`,
      );

      let clipPath: string;
      try {
        clipPath = extractClip(videoName, intent.startSec, intent.endSec);
        console.log(`    clip: ${clipPath}`);
      } catch (e) {
        console.warn(`    ⚠ clip extraction failed: ${e}`);
        continue;
      }

      // Skip clips smaller than 10KB — empty/corrupted (timestamp past video end)
      const { statSync } = await import("fs");
      const clipStat = statSync(clipPath);
      if (clipStat.size < 10_000) {
        console.warn(
          `    ⚠ clip is ${clipStat.size} bytes — timestamp likely past video end, skipping`,
        );
        continue;
      }

      const spatial = analyzeSpatial(clipPath);
      if (!spatial) continue;
      console.log(`    spatial: ${JSON.stringify(spatial).slice(0, 80)}…`);

      const newReasoning = rewriteReasoning(
        clipPath,
        seg.activity,
        intent.category,
        intent.taskSet,
        intent.reasoning,
        spatial as Record<
          string,
          {
            label: string;
            observation: string;
            expertSignal: boolean;
            estimatedMeters?: number;
            efficiencyRatio?: number;
          }
        >,
        intent.score,
      );
      console.log(`    reasoning: ${newReasoning.slice(0, 80)}…`);

      intent.spatialIntelligence = spatial;
      intent.reasoning = newReasoning;
      changed = true;
    }
  }

  if (changed) {
    entry.generatedAt = new Date().toISOString();
    const json = JSON.stringify(entry, null, 2);
    const writeResult = JSON.parse(
      spawnSync("./ee", ["index-write", "behavioral", `entries/${filename}`], {
        cwd: ROOT,
        input: json,
        encoding: "utf8",
      }).stdout,
    );
    console.log(`  ✅ wrote ${writeResult.bytesWritten} bytes`);
  } else {
    console.log(`  — no changes`);
  }
}

// Main
import { readdirSync } from "fs";
const entryFiles = readdirSync(ENTRIES_DIR).filter((f) => f.endsWith(".json"));

// Args: [filter] [--force]
// bun run scripts/backfill-spatial.ts                     — all entries, skip already-enriched
// bun run scripts/backfill-spatial.ts 07_production_mp    — one entry, skip already-enriched
// bun run scripts/backfill-spatial.ts 07_production_mp --force  — one entry, re-process all
// bun run scripts/backfill-spatial.ts --force             — all entries, re-process all
const args = process.argv.slice(2);
const force = args.includes("--force");
const filterArg = args.find((a) => !a.startsWith("--"));
const toProcess = filterArg
  ? entryFiles.filter((f) => f.includes(filterArg))
  : entryFiles;

console.log(
  `\nBackfilling ${toProcess.length} entries with spatial intelligence...\n`,
);

for (const file of toProcess) {
  await processEntry(file, force);
}

console.log("\n✅ Done.");
