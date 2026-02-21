import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";

const INDICES_DIR = resolve(
  import.meta.dirname,
  "../../../../data/.ee/indices",
);

interface ManifestVideo {
  name: string;
  relativePath: string;
  timelinePath: string;
  status: "pending" | "processing" | "done" | "error";
}

interface IndexManifest {
  videos: ManifestVideo[];
}

interface TimelineSegment {
  startSec: number;
  endSec: number;
  activity: string;
  workers?: string[];
  tools?: string[];
  materials?: string[];
  spatialContext?: string;
  safetyNotes?: string[];
  riskLevel?: "low" | "medium" | "high";
  expertiseSignals?: string[];
  inefficiencySignals?: string[];
  communicationEvents?: string[];
  ergonomicNotes?: string[];
}

interface SearchHit {
  score: number;
  videoName: string;
  relativePath: string;
  startSec: number;
  endSec: number;
  activity: string;
  workers: string[];
  tools: string[];
  materials: string[];
  spatialContext: string;
}

const manifestSchema = z.object({
  videos: z
    .array(
      z.object({
        name: z.string(),
        relativePath: z.string(),
        timelinePath: z.string(),
        status: z.enum(["pending", "processing", "done", "error"]),
      }),
    )
    .catch([]),
});

const timelineSegmentSchema = z.object({
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
});

const timelineDocumentSchema = z.object({
  timeline: z
    .object({
      segments: z.array(timelineSegmentSchema).catch([]),
    })
    .optional(),
});

export default async function query(args: string[]): Promise<void> {
  const index = getFlag(args, "index") ?? "default";
  const limit = getNumberFlag(args, "limit") ?? 20;
  const search = getPositionals(args).join(" ").trim();

  if (!search) {
    console.error("Usage: ee query <search> [--index <name>] [--limit <n>]");
    process.exit(1);
  }

  const indexDir = resolve(INDICES_DIR, index);
  const manifestPath = resolve(indexDir, "manifest.json");
  const manifest = await readManifest(manifestPath);

  const doneVideos = manifest.videos.filter((video) => video.status === "done");
  if (doneVideos.length === 0) {
    console.log(`No processed videos found in index "${index}".`);
    return;
  }

  const terms = tokenize(search);
  const hits: SearchHit[] = [];

  for (const video of doneVideos) {
    const timelinePath = resolve(indexDir, video.timelinePath);
    if (!(await fileExists(timelinePath))) continue;

    const timelineRaw: unknown = JSON.parse(
      await readFile(timelinePath, "utf8"),
    );
    const parsedTimeline = timelineDocumentSchema.safeParse(timelineRaw);
    const segments = parsedTimeline.success
      ? (parsedTimeline.data.timeline?.segments ?? [])
      : [];

    for (const segment of segments) {
      const score = scoreSegment(segment, search, terms);
      if (score <= 0) continue;

      hits.push({
        score,
        videoName: video.name,
        relativePath: video.relativePath,
        startSec: segment.startSec,
        endSec: segment.endSec,
        activity: segment.activity,
        workers: segment.workers ?? [],
        tools: segment.tools ?? [],
        materials: segment.materials ?? [],
        spatialContext: segment.spatialContext ?? "",
      });
    }
  }

  hits.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.startSec - b.startSec;
  });

  if (hits.length === 0) {
    console.log(`No results for "${search}" in index "${index}".`);
    return;
  }

  console.log(
    `Results for "${search}" in index "${index}" (${Math.min(limit, hits.length)} shown):\n`,
  );

  for (const hit of hits.slice(0, limit)) {
    const range = `${formatTimestamp(hit.startSec)}-${formatTimestamp(hit.endSec)}`;
    console.log(`[score ${hit.score}] ${hit.videoName}  ${range}`);
    console.log(`  activity: ${hit.activity}`);
    if (hit.workers.length > 0)
      console.log(`  workers: ${hit.workers.join(", ")}`);
    if (hit.tools.length > 0) console.log(`  tools: ${hit.tools.join(", ")}`);
    if (hit.materials.length > 0)
      console.log(`  materials: ${hit.materials.join(", ")}`);
    if (hit.spatialContext) console.log(`  spatial: ${hit.spatialContext}`);
    console.log(`  file: ${hit.relativePath}`);
    console.log("");
  }
}

async function readManifest(manifestPath: string): Promise<IndexManifest> {
  try {
    const raw: unknown = JSON.parse(await readFile(manifestPath, "utf8"));
    const parsedManifest = manifestSchema.safeParse(raw);
    return { videos: parsedManifest.success ? parsedManifest.data.videos : [] };
  } catch {
    console.error("Index manifest not found. Run `ee process` first.");
    process.exit(1);
  }
}

function scoreSegment(
  segment: TimelineSegment,
  search: string,
  terms: string[],
): number {
  const normalizedSearch = search.toLowerCase();
  const haystack = [
    segment.activity,
    ...(segment.workers ?? []),
    ...(segment.tools ?? []),
    ...(segment.materials ?? []),
    segment.spatialContext ?? "",
    ...(segment.safetyNotes ?? []),
    segment.riskLevel ?? "",
    ...(segment.expertiseSignals ?? []),
    ...(segment.inefficiencySignals ?? []),
    ...(segment.communicationEvents ?? []),
    ...(segment.ergonomicNotes ?? []),
  ]
    .join(" ")
    .toLowerCase();

  if (
    !haystack.includes(normalizedSearch) &&
    terms.every((term) => !haystack.includes(term))
  ) {
    return 0;
  }

  let score = 0;
  if (haystack.includes(normalizedSearch)) score += 10;
  for (const term of terms) {
    if (haystack.includes(term)) score += 1;
  }
  return score;
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/\s+/g)
    .map((part) => part.trim())
    .filter(Boolean);
}

function formatTimestamp(seconds: number): string {
  const safeSeconds = Number.isFinite(seconds)
    ? Math.max(0, Math.floor(seconds))
    : 0;
  const h = Math.floor(safeSeconds / 3600);
  const m = Math.floor((safeSeconds % 3600) / 60);
  const s = safeSeconds % 60;
  return [h, m, s].map((n) => String(n).padStart(2, "0")).join(":");
}

function getPositionals(args: string[]): string[] {
  const positionals: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const value = args[i];
    if (value.startsWith("--")) {
      if (i + 1 < args.length && !args[i + 1].startsWith("--")) {
        i++;
      }
      continue;
    }
    positionals.push(value);
  }

  return positionals;
}

function getFlag(args: string[], name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  return i !== -1 && i + 1 < args.length && !args[i + 1].startsWith("--")
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

async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}
