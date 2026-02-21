/**
 * Score command: runs the behavioral preprocessing pipeline on processed timelines.
 *
 * Reads timeline JSON from an index, builds event logs, extracts features,
 * and computes heuristic scores (hesitation, coordination, attention, smoothness).
 * Outputs JSON to stdout or to a file.
 *
 * Usage: ee score [--index <name>] [--output <path>] [--limit <n>]
 */

import { readFile, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";
import { runPipeline } from "../lib/pipeline.js";

const INDICES_DIR = resolve(
  import.meta.dirname,
  "../../../../data/.ee/indices",
);

/** Zod schema for timeline document (we only need segments). */
const timelineDocumentSchema = z.object({
  source: z
    .object({
      name: z.string(),
    })
    .optional(),
  timeline: z
    .object({
      segments: z.array(
        z.object({
          startSec: z.number(),
          endSec: z.number(),
          activity: z.string(),
          workers: z.array(z.string()).optional(),
          tools: z.array(z.string()).optional(),
          materials: z.array(z.string()).optional(),
          spatialContext: z.string().optional(),
          safetyNotes: z.array(z.string()).optional(),
          riskLevel: z.enum(["low", "medium", "high"]).optional(),
          expertiseSignals: z.array(z.string()).optional(),
          inefficiencySignals: z.array(z.string()).optional(),
          communicationEvents: z.array(z.string()).optional(),
          ergonomicNotes: z.array(z.string()).optional(),
        }),
      ),
    })
    .optional(),
});

type TimelineDocument = z.infer<typeof timelineDocumentSchema>;

async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

function getFlag(args: string[], name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  return i !== -1 && i + 1 < args.length && !args[i + 1]!.startsWith("--")
    ? args[i + 1]
    : undefined;
}

function getNumberFlag(args: string[], name: string): number | undefined {
  const raw = getFlag(args, name);
  if (raw == null) return undefined;
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || value <= 0) {
    console.error(
      `Invalid --${name} value: "${raw}". Expected a positive integer.`,
    );
    process.exit(1);
  }
  return value;
}

export default async function scoreCommand(args: string[]): Promise<void> {
  const index = getFlag(args, "index") ?? "default";
  const outputPath = getFlag(args, "output");
  const limit = getNumberFlag(args, "limit");

  const indexDir = resolve(INDICES_DIR, index);
  const manifestPath = resolve(indexDir, "manifest.json");

  if (!(await fileExists(manifestPath))) {
    console.error(`Index "${index}" not found at ${manifestPath}`);
    process.exit(1);
  }

  const manifestRaw: unknown = JSON.parse(await readFile(manifestPath, "utf8"));
  const videos = Array.isArray((manifestRaw as { videos?: unknown[] }).videos)
    ? (
        manifestRaw as {
          videos: { timelinePath: string; name: string; status: string }[];
        }
      ).videos
    : [];

  const doneVideos = videos.filter((v) => v.status === "done");
  if (doneVideos.length === 0) {
    console.error(`No processed videos found in index "${index}".`);
    process.exit(1);
  }

  const worklist = limit == null ? doneVideos : doneVideos.slice(0, limit);

  const results: ReturnType<typeof runPipeline>[] = [];

  for (let i = 0; i < worklist.length; i++) {
    const video = worklist[i]!;
    const timelinePath = resolve(indexDir, video.timelinePath);

    if (!(await fileExists(timelinePath))) {
      console.error(`Timeline not found: ${timelinePath}`);
      continue;
    }

    const timelineRaw: unknown = JSON.parse(
      await readFile(timelinePath, "utf8"),
    );
    const parsed = timelineDocumentSchema.safeParse(timelineRaw);
    const doc = parsed.success ? (parsed.data as TimelineDocument) : null;

    if (!doc?.timeline?.segments?.length) {
      console.error(`No segments in timeline: ${video.name}`);
      continue;
    }

    const videoId = video.timelinePath
      .replace(/\.timeline\.json$/, "")
      .replace(/^timelines\//, "");
    const videoName = doc.source?.name ?? video.name;

    const result = runPipeline(
      doc.timeline.segments as Parameters<typeof runPipeline>[0],
      videoId,
      videoName,
    );

    results.push(result);

    console.error(
      `[${i + 1}/${worklist.length}] ${videoName}: hesitation=${result.scores.hesitationScore.toFixed(1)} coord=${result.scores.coordinationScore.toFixed(1)} attention=${result.scores.attentionScore.toFixed(1)} smooth=${result.scores.smoothnessScore.toFixed(1)} overall=${result.scores.overallScore.toFixed(1)}`,
    );
  }

  const output = {
    index,
    generatedAt: new Date().toISOString(),
    videos: results.map((r) => ({
      videoId: r.videoId,
      videoName: r.videoName,
      eventCount: r.eventCount,
      scores: r.scores,
      features: r.features,
    })),
  };

  const json = JSON.stringify(output, null, 2);

  if (outputPath) {
    await writeFile(outputPath, `${json}\n`, "utf8");
    console.error(`Wrote ${outputPath}`);
  } else {
    console.log(json);
  }
}
