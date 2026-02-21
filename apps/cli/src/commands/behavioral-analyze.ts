/**
 * behavioral-analyze: run the agentic Claude behavioral pipeline on
 * construction timeline files and write scored implicit-intent analyses
 * to the behavioral index.
 *
 * Usage:
 *   ee behavioral-analyze                       Process all timelines
 *   ee behavioral-analyze <hash-or-filename>    Process one timeline by ID
 *   ee behavioral-analyze --model <model-id>    Override default Claude model
 *
 * Output: data/index/behavioral/entries/<videoName>.json
 */

import { readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, basename } from "node:path";

import { getFlag, getPositionals } from "../args.js";
import { env } from "../env.js";
import { PROJECT_ROOT } from "../paths.js";
import { runBehavioralPipeline } from "../lib/behavioral-pipeline.js";

const TIMELINES_DIR = join(
  PROJECT_ROOT,
  "data/.ee/indices/construction/timelines",
);

export default async function behavioralAnalyze(args: string[]): Promise<void> {
  const positionals = getPositionals(args);
  const targetId = positionals[0];
  const model = getFlag(args, "model") ?? env.EE_ANTHROPIC_MODEL;

  let files: string[];

  if (targetId) {
    const filename = targetId.endsWith(".timeline.json")
      ? targetId
      : `${targetId}.timeline.json`;
    const full = join(TIMELINES_DIR, filename);
    if (!existsSync(full)) {
      console.error(`Timeline not found: ${full}`);
      process.exit(1);
    }
    files = [full];
  } else {
    if (!existsSync(TIMELINES_DIR)) {
      console.error(`Timelines directory not found: ${TIMELINES_DIR}`);
      process.exit(1);
    }
    const entries = await readdir(TIMELINES_DIR);
    files = entries
      .filter((f) => f.endsWith(".timeline.json"))
      .map((f) => join(TIMELINES_DIR, f))
      .sort();
  }

  if (files.length === 0) {
    console.error("No timeline files found.");
    process.exit(1);
  }

  console.log(`Behavioral analysis — model: ${model}`);
  console.log(`Processing ${files.length} timeline(s)...\n`);

  let succeeded = 0;
  let failed = 0;

  for (const file of files) {
    const videoId = basename(file).replace(".timeline.json", "");
    process.stdout.write(`  [${videoId}] `);

    try {
      const result = await runBehavioralPipeline(file, videoId, model);

      const totalIntents = result.segments.reduce(
        (sum, s) => sum + s.implicitIntents.length,
        0,
      );
      const byCategory = result.segments
        .flatMap((s) => s.implicitIntents)
        .reduce<Record<string, number>>((acc, intent) => {
          acc[intent.category] = (acc[intent.category] ?? 0) + 1;
          return acc;
        }, {});

      const catSummary = Object.entries(byCategory)
        .map(([k, v]) => `${k}:${v}`)
        .join(" ");

      console.log(
        `✓  ${result.videoName}  —  ` +
          `${result.segments.length} segments, ${totalIntents} intents` +
          (catSummary ? `  (${catSummary})` : ""),
      );
      succeeded++;
    } catch (err) {
      console.log(`✗  ${err instanceof Error ? err.message : String(err)}`);
      failed++;
    }
  }

  console.log(
    `\nDone: ${succeeded} succeeded${failed > 0 ? `, ${failed} failed` : ""}.`,
  );
  if (failed > 0) process.exit(1);
}
