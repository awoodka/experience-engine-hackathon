/**
 * Process command: builds or resumes a behavioral index from construction-site video.
 * Scans `data/` for videos, invokes Gemini for structured timeline extraction,
 * and persists timelines under `data/.ee/indices/<index>/timelines/`.
 */
import { createHash } from "node:crypto";
import {
  mkdir,
  readdir,
  readFile,
  rename,
  stat,
  writeFile,
} from "node:fs/promises";
import { extname, resolve } from "node:path";
import { Output, generateText, jsonSchema } from "ai";
import { google } from "@ai-sdk/google";
import { z } from "zod";
import { env } from "../env";

/** Root directory for video files (relative to CLI package). */
const DATA_DIR = resolve(import.meta.dirname, "../../../../data/videos");
/** Directory containing all behavioral indices. */
const INDICES_DIR = resolve(
  import.meta.dirname,
  "../../../../data/.ee/indices",
);
/** Subdirectory name for timeline JSON files per index. */
const TIMELINES_DIR_NAME = "timelines";
/** Default index name when --index is not specified. */
const DEFAULT_INDEX = "default";

/** File extensions treated as video for discovery. */
const VIDEO_EXTENSIONS = new Set([
  ".mp4",
  ".mov",
  ".m4v",
  ".avi",
  ".mkv",
  ".webm",
  ".mpeg",
  ".mpg",
]);

/** Built-in prompt sent to Gemini to guide behavioral timeline extraction. */
const DEFAULT_ANALYSIS_PROMPT = `
You are an expert construction-site behavior analyst.

Analyze the video and produce a behavioral timeline that makes expert actions searchable.
Focus on:
- concrete actions and sequence of work
- worker positioning and spatial relationships
- safety-relevant behavior (assign riskLevel: low/medium/high per segment)
- efficiency and craft-quality signals (expertiseSignals)
- inefficiency indicators like wasted motion, rework, idle time, poor sequencing (inefficiencySignals)
- communication between workers: verbal cues, hand signals, coordination events (communicationEvents)
- ergonomic observations: body mechanics, posture, lifting technique, repetitive strain risks (ergonomicNotes)

Use timestamp segments that are granular enough to query later (typically 5-45 seconds).
Prefer concise, objective descriptions over speculation.
Use empty arrays when a signal type is not observed in a segment.
`.trim();

/** Processing status for a video in the manifest. */
type VideoStatus = "pending" | "processing" | "done" | "error";

/** Metadata for a discovered video file on disk. */
interface VideoSource {
  /** Short hash-based id (first 12 chars of sha1 of path). */
  id: string;
  name: string;
  absolutePath: string;
  relativePath: string;
  sizeBytes: number;
  mtimeMs: number;
  /** SHA-256 of path:size:mtime used to detect file changes. */
  fileFingerprint: string;
}

/** High-level phase of work within a video (e.g. setup, assembly, cleanup). */
interface TimelinePhase {
  label: string;
  startSec: number;
  endSec: number;
}

/** Single behavioral segment within the timeline. */
interface TimelineSegment {
  startSec: number;
  endSec: number;
  /** Brief description of the activity in this segment. */
  activity: string;
  /** Worker labels or descriptions present. */
  workers: string[];
  /** Tools used or visible. */
  tools: string[];
  /** Materials involved. */
  materials: string[];
  /** Spatial context (location, layout, positioning). */
  spatialContext: string;
  /** Safety-related observations. */
  safetyNotes: string[];
  riskLevel: "low" | "medium" | "high";
  /** Signs of expertise (craft quality, efficiency). */
  expertiseSignals: string[];
  /** Signs of inefficiency (wasted motion, rework, idle time). */
  inefficiencySignals: string[];
  /** Verbal cues, hand signals, coordination events. */
  communicationEvents: string[];
  /** Body mechanics, posture, lifting technique, strain risks. */
  ergonomicNotes: string[];
}

/** Full timeline output returned by Gemini. */
interface TimelineOutput {
  videoSummary: string;
  highLevelPhases: TimelinePhase[];
  segments: TimelineSegment[];
}

/** Wrapper for persisted timeline including provenance metadata. */
interface TimelineDocument {
  schemaVersion: number;
  generatedAt: string;
  source: {
    name: string;
    relativePath: string;
    sizeBytes: number;
    mtimeMs: number;
    fileFingerprint: string;
  };
  modelId: string;
  /** Hash of prompt used for analysis (for invalidation). */
  promptHash: string;
  timeline: TimelineOutput;
}

/** Video entry in the index manifest. */
interface ManifestVideo {
  /** Short hash-based id (first 12 chars of sha1 of path). */
  id: string;
  name: string;
  relativePath: string;
  sizeBytes: number;
  mtimeMs: number;
  fileFingerprint: string;
  /** Path to timeline JSON relative to index dir (e.g. timelines/abc123.timeline.json). */
  timelinePath: string;
  status: VideoStatus;
  modelId: string;
  promptHash: string;
  startedAt?: string;
  processedAt?: string;
  error?: string;
}

/** Manifest file structure for an index (manifest.json). */
interface IndexManifest {
  version: number;
  schemaVersion: number;
  index: string;
  createdAt: string;
  updatedAt: string;
  promptPath: string | null;
  promptHash: string;
  modelId: string;
  videos: ManifestVideo[];
}

/** Zod schema for validating manifest video entries on disk. */
const manifestVideoSchema = z.object({
  id: z.string(),
  name: z.string(),
  relativePath: z.string(),
  sizeBytes: z.number(),
  mtimeMs: z.number(),
  fileFingerprint: z.string(),
  timelinePath: z.string(),
  status: z.enum(["pending", "processing", "done", "error"]),
  modelId: z.string(),
  promptHash: z.string(),
  startedAt: z.string().optional(),
  processedAt: z.string().optional(),
  error: z.string().optional(),
});

/** Zod schema for the persisted manifest JSON (permits missing fields for migration). */
const persistedManifestSchema = z.object({
  version: z.number().optional(),
  schemaVersion: z.number().optional(),
  index: z.string().optional(),
  createdAt: z.string().optional(),
  videos: z.array(manifestVideoSchema).catch([]),
});

/** JSON schema for Gemini structured output (timeline). */
const TIMELINE_SCHEMA = jsonSchema<TimelineOutput>({
  type: "object",
  additionalProperties: false,
  properties: {
    videoSummary: { type: "string" },
    highLevelPhases: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          label: { type: "string" },
          startSec: { type: "number" },
          endSec: { type: "number" },
        },
        required: ["label", "startSec", "endSec"],
      },
    },
    segments: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          startSec: { type: "number" },
          endSec: { type: "number" },
          activity: { type: "string" },
          workers: { type: "array", items: { type: "string" } },
          tools: { type: "array", items: { type: "string" } },
          materials: { type: "array", items: { type: "string" } },
          spatialContext: { type: "string" },
          safetyNotes: { type: "array", items: { type: "string" } },
          riskLevel: { type: "string", enum: ["low", "medium", "high"] },
          expertiseSignals: { type: "array", items: { type: "string" } },
          inefficiencySignals: { type: "array", items: { type: "string" } },
          communicationEvents: { type: "array", items: { type: "string" } },
          ergonomicNotes: { type: "array", items: { type: "string" } },
        },
        required: [
          "startSec",
          "endSec",
          "activity",
          "workers",
          "tools",
          "materials",
          "spatialContext",
          "safetyNotes",
          "riskLevel",
          "expertiseSignals",
          "inefficiencySignals",
          "communicationEvents",
          "ergonomicNotes",
        ],
      },
    },
  },
  required: ["videoSummary", "highLevelPhases", "segments"],
});

/**
 * Main process command entry point.
 * Discovers videos, reconciles manifest, queues work, and processes each video via Gemini.
 */
export default async function processCommand(args: string[]): Promise<void> {
  const index = getFlag(args, "index") ?? DEFAULT_INDEX;
  const promptArg = getFlag(args, "prompt");
  const modelId = getFlag(args, "model") ?? env.EE_GEMINI_MODEL;
  const force = hasFlag(args, "force");
  const limit = getNumberFlag(args, "limit");

  const indexDir = resolve(INDICES_DIR, index);
  const timelinesDir = resolve(indexDir, TIMELINES_DIR_NAME);
  const manifestPath = resolve(indexDir, "manifest.json");

  // Ensure index and timelines directories exist
  await mkdir(timelinesDir, { recursive: true });

  const { promptText, promptPath, promptHash } = await loadPrompt(promptArg);
  const videos = await discoverVideos(DATA_DIR);

  if (videos.length === 0) {
    console.error(`No videos found in ${DATA_DIR}.`);
    process.exit(1);
  }

  const manifest = await loadManifest(
    manifestPath,
    index,
    promptPath,
    promptHash,
    modelId,
  );
  const existingByPath = new Map(
    manifest.videos.map((v) => [v.relativePath, v]),
  );

  const queue: VideoSource[] = [];
  manifest.videos = [];

  // Reconcile manifest with discovered videos; queue videos that need reprocessing
  for (const source of videos) {
    const existing = existingByPath.get(source.relativePath);
    const timelinePath =
      existing?.timelinePath ??
      `${TIMELINES_DIR_NAME}/${source.id}.timeline.json`;
    const timelineExists = await fileExists(resolve(indexDir, timelinePath));

    // Determine if this video must be reprocessed
    const needsReprocess =
      force ||
      !existing ||
      existing.status !== "done" ||
      !timelineExists ||
      existing.fileFingerprint !== source.fileFingerprint ||
      existing.promptHash !== promptHash ||
      existing.modelId !== modelId;

    const next: ManifestVideo = {
      id: source.id,
      name: source.name,
      relativePath: source.relativePath,
      sizeBytes: source.sizeBytes,
      mtimeMs: source.mtimeMs,
      fileFingerprint: source.fileFingerprint,
      timelinePath,
      status: needsReprocess ? "pending" : "done",
      modelId,
      promptHash,
      processedAt: !needsReprocess ? existing?.processedAt : undefined,
      startedAt: undefined,
      error: undefined,
    };

    manifest.videos.push(next);

    if (needsReprocess) {
      queue.push(source);
    }
  }

  await saveManifest(manifestPath, manifest);

  const worklist = limit == null ? queue : queue.slice(0, limit);

  console.log(`Index: ${index}`);
  console.log(`Model: ${modelId}`);
  console.log(`Prompt: ${promptPath ?? "built-in default"}`);
  console.log(`Prompt hash: ${promptHash}`);
  console.log(`Videos discovered: ${videos.length}`);
  console.log(`Videos needing processing: ${queue.length}`);
  if (limit != null) {
    console.log(`Processing limit: ${worklist.length}`);
  }

  if (worklist.length === 0) {
    console.log("Index is up to date. Nothing to process.");
    return;
  }

  const manifestByPath = new Map(
    manifest.videos.map((v) => [v.relativePath, v]),
  );
  let ok = 0;
  let failed = 0;

  for (let i = 0; i < worklist.length; i++) {
    const source = worklist[i];
    const entry = manifestByPath.get(source.relativePath);

    if (!entry) continue;

    // Mark as processing and persist before starting (for resume visibility)
    entry.status = "processing";
    entry.startedAt = new Date().toISOString();
    entry.error = undefined;
    await saveManifest(manifestPath, manifest);

    console.log(
      `\n[${i + 1}/${worklist.length}] Analyzing ${source.name} (${formatBytes(source.sizeBytes)})`,
    );

    try {
      const timeline = await analyzeVideo(source, promptText, modelId);
      const timelineDoc: TimelineDocument = {
        schemaVersion: 1,
        generatedAt: new Date().toISOString(),
        source: {
          name: source.name,
          relativePath: source.relativePath,
          sizeBytes: source.sizeBytes,
          mtimeMs: source.mtimeMs,
          fileFingerprint: source.fileFingerprint,
        },
        modelId,
        promptHash,
        timeline,
      };

      await writeJson(resolve(indexDir, entry.timelinePath), timelineDoc);

      entry.status = "done";
      entry.processedAt = new Date().toISOString();
      entry.error = undefined;
      ok++;
      console.log(`Done: ${source.name}`);
    } catch (error) {
      entry.status = "error";
      entry.error = toErrorMessage(error);
      failed++;
      console.error(`Failed: ${source.name}`);
      console.error(`  ${entry.error}`);
    }

    await saveManifest(manifestPath, manifest);
  }

  const doneCount = manifest.videos.filter((v) => v.status === "done").length;
  const errorCount = manifest.videos.filter((v) => v.status === "error").length;

  console.log("\nProcessing complete.");
  console.log(`Processed successfully this run: ${ok}`);
  console.log(`Failed this run: ${failed}`);
  console.log(`Total done in index: ${doneCount}/${manifest.videos.length}`);
  if (errorCount > 0) {
    console.log(`Videos with errors in manifest: ${errorCount}`);
  }
}

/**
 * Analyzes a video with Gemini and returns a structured behavioral timeline.
 * Uses structured output (TIMELINE_SCHEMA) to enforce the timeline format.
 */
async function analyzeVideo(
  source: VideoSource,
  promptText: string,
  modelId: string,
): Promise<TimelineOutput> {
  const bytes = await readFile(source.absolutePath);
  const mediaType = mediaTypeFromPath(source.name);

  const { output } = await generateText({
    model: google(modelId),
    output: Output.object({ schema: TIMELINE_SCHEMA }),
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: buildPromptForVideo(source, promptText) },
          {
            type: "file",
            data: bytes,
            mediaType,
            filename: source.name,
          },
        ],
      },
    ],
  });

  return output;
}

/**
 * Builds the full prompt sent to Gemini (instructions + video filename + behavioral prompt).
 */
function buildPromptForVideo(source: VideoSource, promptText: string): string {
  return [
    "Analyze this construction-site video and extract a structured behavioral timeline.",
    "Capture timestamps in seconds from the start of the video.",
    "Use empty arrays when information is unknown.",
    `Video file: ${source.name}`,
    "",
    "Behavioral analysis instructions:",
    promptText,
  ].join("\n");
}

/**
 * Scans a directory for video files (by extension) and returns metadata.
 * Sorts by filename. Uses SHA-1 of path for id and SHA-256 of path:size:mtime for fingerprint.
 */
async function discoverVideos(root: string): Promise<VideoSource[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const videos: VideoSource[] = [];

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (!VIDEO_EXTENSIONS.has(extname(entry.name).toLowerCase())) continue;

    const absolutePath = resolve(root, entry.name);
    const fileStat = await stat(absolutePath);
    const relativePath = entry.name;
    const id = createHash("sha1")
      .update(relativePath)
      .digest("hex")
      .slice(0, 12);
    const fileFingerprint = createHash("sha256")
      .update(`${relativePath}:${fileStat.size}:${fileStat.mtimeMs}`)
      .digest("hex");

    videos.push({
      id,
      name: entry.name,
      absolutePath,
      relativePath,
      sizeBytes: fileStat.size,
      mtimeMs: fileStat.mtimeMs,
      fileFingerprint,
    });
  }

  videos.sort((a, b) => a.name.localeCompare(b.name));
  return videos;
}

/**
 * Loads the analysis prompt: from file if --prompt given, else built-in default.
 * Returns prompt text, path (or null), and SHA-256 hash for invalidation.
 */
async function loadPrompt(promptArg: string | undefined): Promise<{
  promptText: string;
  promptPath: string | null;
  promptHash: string;
}> {
  if (!promptArg) {
    return {
      promptText: DEFAULT_ANALYSIS_PROMPT,
      promptPath: null,
      promptHash: hashText(DEFAULT_ANALYSIS_PROMPT),
    };
  }

  const promptPath = resolve(process.cwd(), promptArg);
  const promptText = await readFile(promptPath, "utf8");

  return {
    promptText,
    promptPath,
    promptHash: hashText(promptText),
  };
}

/**
 * Loads or creates the index manifest. Creates empty manifest if file missing or invalid.
 * Overwrites promptPath, promptHash, modelId with current run values.
 */
async function loadManifest(
  manifestPath: string,
  index: string,
  promptPath: string | null,
  promptHash: string,
  modelId: string,
): Promise<IndexManifest> {
  const now = new Date().toISOString();

  if (!(await fileExists(manifestPath))) {
    return {
      version: 1,
      schemaVersion: 1,
      index,
      createdAt: now,
      updatedAt: now,
      promptPath,
      promptHash,
      modelId,
      videos: [],
    };
  }

  try {
    const raw: unknown = JSON.parse(await readFile(manifestPath, "utf8"));
    const parsed = persistedManifestSchema.safeParse(raw);
    const persisted = parsed.success
      ? parsed.data
      : {
          version: undefined,
          schemaVersion: undefined,
          index: undefined,
          createdAt: undefined,
          videos: [],
        };
    return {
      version: persisted.version ?? 1,
      schemaVersion: persisted.schemaVersion ?? 1,
      index: persisted.index ?? index,
      createdAt: persisted.createdAt ?? now,
      updatedAt: now,
      promptPath,
      promptHash,
      modelId,
      videos: persisted.videos,
    };
  } catch {
    return {
      version: 1,
      schemaVersion: 1,
      index,
      createdAt: now,
      updatedAt: now,
      promptPath,
      promptHash,
      modelId,
      videos: [],
    };
  }
}

/**
 * Saves manifest atomically (write to .tmp, then rename).
 */
async function saveManifest(
  manifestPath: string,
  manifest: IndexManifest,
): Promise<void> {
  manifest.updatedAt = new Date().toISOString();
  const tmpPath = `${manifestPath}.tmp`;
  await writeJson(tmpPath, manifest);
  await rename(tmpPath, manifestPath);
}

/** Writes JSON with pretty-print (2 spaces) and trailing newline. */
async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

/** Returns true if path exists, false if stat throws (e.g. ENOENT). */
async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/** Maps file extension to MIME type for Gemini video API. */
function mediaTypeFromPath(path: string): string {
  const ext = extname(path).toLowerCase();

  if (ext === ".mov") return "video/quicktime";
  if (ext === ".avi") return "video/x-msvideo";
  if (ext === ".mkv") return "video/x-matroska";
  if (ext === ".webm") return "video/webm";
  if (ext === ".mpeg" || ext === ".mpg") return "video/mpeg";
  return "video/mp4";
}

/** SHA-256 hash of text (used for prompt invalidation). */
function hashText(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/** Formats byte count as human-readable string (e.g. 1024 -> "1KB"). */
function formatBytes(bytes: number): string {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex++;
  }

  const rounded = value >= 10 ? value.toFixed(0) : value.toFixed(1);
  return `${rounded}${units[unitIndex]}`;
}

/** Extracts a safe string from an unknown error for logging. */
function toErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

/** Gets the value of --<name> <value> from args. */
function getFlag(args: string[], name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  return i !== -1 && i + 1 < args.length && !args[i + 1].startsWith("--")
    ? args[i + 1]
    : undefined;
}

/** Returns true if --<name> is present in args. */
function hasFlag(args: string[], name: string): boolean {
  return args.includes(`--${name}`);
}

/** Parses --<name> value as positive integer; exits with error if invalid. */
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
