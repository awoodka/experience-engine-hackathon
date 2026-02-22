#!/usr/bin/env bun
/**
 * Extracts implicit intent moments from the behavioral index into
 * a standalone implicit-intent index with flat, searchable entries.
 *
 * Cross-references the construction index for trade data.
 * No Gemini calls — purely deterministic extraction and synthesis.
 *
 * Usage:
 *   bun run scripts/backfill-implicit-intent.ts                  — all videos
 *   bun run scripts/backfill-implicit-intent.ts 05_production_mp — single video
 *   bun run scripts/backfill-implicit-intent.ts --force          — overwrite existing
 */

import { spawnSync } from "child_process";
import { existsSync, readFileSync, readdirSync } from "fs";
import { join } from "path";

const ROOT = new URL("..", import.meta.url).pathname;
const BEHAVIORAL_DIR = join(ROOT, "data/index/behavioral/entries");
const CONSTRUCTION_DIR = join(ROOT, "data/index/construction/entries");
const OUTPUT_DIR = join(ROOT, "data/index/implicit-intent/entries");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ee(args: string[], input?: string): string {
  const result = spawnSync("./ee", args, {
    cwd: ROOT,
    input,
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`ee ${args.join(" ")} failed:\n${result.stderr}`);
  }
  return result.stdout.trim();
}

function deriveSkillLevel(
  score: number,
): "novice" | "developing" | "competent" | "proficient" | "expert" {
  if (score >= 80) return "expert";
  if (score >= 60) return "proficient";
  if (score >= 40) return "competent";
  if (score >= 20) return "developing";
  return "novice";
}

function synthesizeDescription(
  category: string,
  activity: string,
  score: number,
  skillLevel: string,
  taskSet: string[],
): string {
  const verb: Record<string, string> = {
    hesitation: "hesitation pattern detected",
    coordination: "coordination behavior observed",
    attention: "attention signal identified",
    smoothness: "workflow smoothness measured",
  };
  const activityShort =
    activity.length > 80 ? activity.slice(0, 77) + "..." : activity;
  return (
    `${capitalize(skillLevel)}-level ${verb[category] ?? category} during ${activityShort.toLowerCase()}` +
    ` (score ${score}/100, tasks: ${taskSet.join(" \u2192 ")})`
  );
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ---------------------------------------------------------------------------
// Load construction index for trade lookup
// ---------------------------------------------------------------------------

interface ConstructionEntry {
  startSec: number;
  endSec: number;
  trade: string;
}

function loadConstructionMap(): Map<string, ConstructionEntry[]> {
  const map = new Map<string, ConstructionEntry[]>();
  if (!existsSync(CONSTRUCTION_DIR)) return map;

  for (const file of readdirSync(CONSTRUCTION_DIR).filter((f) =>
    f.endsWith(".json"),
  )) {
    const entries = JSON.parse(
      readFileSync(join(CONSTRUCTION_DIR, file), "utf8"),
    ) as ConstructionEntry[];
    const key = file.replace(".json", "");
    map.set(key, entries);
  }
  return map;
}

function findTrade(
  constructionMap: Map<string, ConstructionEntry[]>,
  videoBaseName: string,
  startSec: number,
  endSec: number,
): string {
  const entries = constructionMap.get(videoBaseName);
  if (!entries || entries.length === 0) return "General";

  // Find segment with best timestamp overlap
  let bestTrade = entries[0].trade ?? "General";
  let bestOverlap = 0;

  for (const seg of entries) {
    const overlapStart = Math.max(seg.startSec, startSec);
    const overlapEnd = Math.min(seg.endSec, endSec);
    const overlap = Math.max(0, overlapEnd - overlapStart);
    if (overlap > bestOverlap) {
      bestOverlap = overlap;
      bestTrade = seg.trade;
    }
  }

  return bestTrade || "General";
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const constructionMap = loadConstructionMap();

const behavioralFiles = readdirSync(BEHAVIORAL_DIR).filter((f) =>
  f.endsWith(".json"),
);

// Parse args
const args = process.argv.slice(2);
const force = args.includes("--force");
const filterArg = args.find((a) => !a.startsWith("--"));
const toProcess = filterArg
  ? behavioralFiles.filter((f) => f.includes(filterArg))
  : behavioralFiles;

console.log(
  `\nExtracting implicit intents from ${toProcess.length} behavioral entries...\n`,
);

let totalIntents = 0;
const categoryCounts: Record<string, number> = {};
const skillCounts: Record<string, number> = {};

for (const file of toProcess) {
  const videoBaseName = file.replace(".json", "");
  const outputPath = join(OUTPUT_DIR, file);

  // Skip if output exists and not forcing
  if (existsSync(outputPath) && !force) {
    console.log(
      `  ${videoBaseName}: already exists — skipping (use --force to overwrite)`,
    );
    continue;
  }

  const entry = JSON.parse(readFileSync(join(BEHAVIORAL_DIR, file), "utf8"));
  const videoName: string = entry.videoName;

  // Skip entries without implicitIntents structure
  if (
    !entry.segments ||
    !Array.isArray(entry.segments) ||
    !entry.segments.some(
      (s: { implicitIntents?: unknown[] }) =>
        Array.isArray(s.implicitIntents) && s.implicitIntents.length > 0,
    )
  ) {
    console.log(`  ${videoBaseName}: no implicitIntents — skipping`);
    continue;
  }

  const flatEntries: Record<string, unknown>[] = [];

  for (const seg of entry.segments) {
    if (!Array.isArray(seg.implicitIntents)) continue;

    for (let i = 0; i < seg.implicitIntents.length; i++) {
      const intent = seg.implicitIntents[i];
      const skillLevel = deriveSkillLevel(intent.score);
      const trade = findTrade(
        constructionMap,
        videoBaseName,
        intent.startSec,
        intent.endSec,
      );

      const flat: Record<string, unknown> = {
        video: videoName,
        startSec: intent.startSec,
        endSec: intent.endSec,
        category: intent.category,
        intentScore: intent.score,
        skillLevel,
        description: synthesizeDescription(
          intent.category,
          seg.activity,
          intent.score,
          skillLevel,
          intent.taskSet,
        ),
        activity: seg.activity,
        taskSet: intent.taskSet,
        trade,
        clipVerified: intent.clipVerified ?? "partial",
      };

      // Optional fields — carry forward if present
      if (intent.reasoning) flat.reasoning = intent.reasoning;
      if (intent.features) flat.features = intent.features;
      if (intent.spatialIntelligence)
        flat.spatialIntelligence = intent.spatialIntelligence;
      if (intent.salienceScore != null)
        flat.salienceScore = intent.salienceScore;
      if (intent.salienceLevel) flat.salienceLevel = intent.salienceLevel;
      if (intent.tutorialRecommendation)
        flat.tutorialRecommendation = intent.tutorialRecommendation;

      flat.sourceSegment = seg.segmentIndex ?? 0;
      flat.sourceIntentIndex = i;

      flatEntries.push(flat);

      // Track counts
      categoryCounts[intent.category] =
        (categoryCounts[intent.category] ?? 0) + 1;
      skillCounts[skillLevel] = (skillCounts[skillLevel] ?? 0) + 1;
    }
  }

  if (flatEntries.length === 0) {
    console.log(`  ${videoBaseName}: 0 intents extracted — skipping`);
    continue;
  }

  // Write via ee index-write
  const json = JSON.stringify(flatEntries, null, 2);
  const writeResult = JSON.parse(
    ee(["index-write", "implicit-intent", `entries/${file}`], json),
  );
  totalIntents += flatEntries.length;
  console.log(
    `  ${videoBaseName}: ${flatEntries.length} intents (${writeResult.bytesWritten} bytes)`,
  );
}

console.log(`\n--- Summary ---`);
console.log(`Total intents: ${totalIntents}`);
console.log(`By category:`, categoryCounts);
console.log(`By skill level:`, skillCounts);
console.log(`\nDone.`);
