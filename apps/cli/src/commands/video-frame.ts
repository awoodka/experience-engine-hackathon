/**
 * video-frame command: extracts a single JPEG frame from a video at a given timestamp,
 * optionally drawing a bounding box.
 *
 * Usage A (raw):         ee video-frame <file> <seconds> [--region x,y,w,h]
 * Usage B (observation): ee video-frame --index <index> --file <subpath> --obs <n>
 *
 * Requires ffmpeg to be installed.
 */
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { getFlag, getPositionals } from "../args.js";
import { PROJECT_ROOT, FRAMES_DIR, INDEX_DIR, VIDEOS_DIR } from "../paths.js";
interface Region {
  x: number;
  y: number;
  w: number;
  h: number;
}

export default async function videoFrame(args: string[]): Promise<void> {
  const indexName = getFlag(args, "index");
  const entryRaw = getFlag(args, "entry");

  if (indexName && entryRaw != null) {
    await fromEntry(args, indexName, entryRaw);
  } else {
    await fromRaw(args);
  }
}

async function fromEntry(
  args: string[],
  indexName: string,
  entryRaw: string,
): Promise<void> {
  const filePath = getFlag(args, "file");
  if (!filePath) {
    console.error(
      "Usage: ee video-frame --index <index> --file <subpath> --entry <n>",
    );
    console.error(
      "  e.g. ee video-frame --index safety --file entries/13_transit_prep_mp.json --entry 2",
    );
    process.exit(1);
  }

  const jsonPath = resolve(INDEX_DIR, indexName, filePath);
  if (!jsonPath.startsWith(resolve(INDEX_DIR, indexName))) {
    console.error("Path traversal not allowed.");
    process.exit(1);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(jsonPath, "utf8"));
  } catch {
    console.error(`Could not read index file: ${indexName}/${filePath}`);
    process.exit(1);
  }

  const entryIndex = parseInt(entryRaw, 10);
  if (
    !Array.isArray(parsed) ||
    !Number.isFinite(entryIndex) ||
    entryIndex < 0
  ) {
    console.error(
      "Index file must be a JSON array and --entry must be a valid index.",
    );
    process.exit(1);
  }

  const entry = parsed[entryIndex] as
    | { timestamp_sec?: number; startSec?: number; region?: Region }
    | undefined;
  if (!entry) {
    console.error(
      `Entry ${entryIndex} not found. Array has ${parsed.length} items (0-${parsed.length - 1}).`,
    );
    process.exit(1);
  }

  const seconds = entry.timestamp_sec ?? entry.startSec;
  if (seconds == null || !Number.isFinite(seconds)) {
    console.error("Entry missing timestamp_sec or startSec.");
    process.exit(1);
  }

  // Derive video path from the JSON filename
  const jsonBase = basename(filePath, ".json");
  const videoPath = resolve(VIDEOS_DIR, `${jsonBase}.mp4`);

  await extractFrame(videoPath, seconds, entry.region ?? null);
}

async function fromRaw(args: string[]): Promise<void> {
  const positionals = getPositionals(args);
  const filePath = positionals[0];
  const secondsRaw = positionals[1];

  if (!filePath || secondsRaw == null) {
    console.error("Usage: ee video-frame <file> <seconds> [--region x,y,w,h]");
    console.error(
      "       ee video-frame --index <index> --file <subpath> --obs <n>",
    );
    process.exit(1);
  }

  const seconds = parseFloat(secondsRaw);
  if (!Number.isFinite(seconds) || seconds < 0) {
    console.error(
      `Invalid timestamp: "${secondsRaw}". Expected a non-negative number.`,
    );
    process.exit(1);
  }

  const regionRaw = getFlag(args, "region");
  let region: Region | null = null;
  if (regionRaw) {
    const parts = regionRaw.split(",").map(Number);
    if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) {
      console.error(
        `Invalid --region: "${regionRaw}". Expected x,y,w,h (e.g. 0.45,0.7,0.3,0.2)`,
      );
      process.exit(1);
    }
    region = { x: parts[0], y: parts[1], w: parts[2], h: parts[3] };
  }

  // Try the path as given first, then fall back to data/videos/<filename>
  let absolutePath = resolve(PROJECT_ROOT, filePath);
  if (!existsSync(absolutePath)) {
    const fallback = resolve(VIDEOS_DIR, basename(filePath));
    if (existsSync(fallback)) {
      absolutePath = fallback;
    }
  }
  await extractFrame(absolutePath, seconds, region);
}

async function extractFrame(
  videoPath: string,
  seconds: number,
  region: Region | null,
): Promise<void> {
  const videoName = basename(videoPath);
  const hash = createHash("sha1").update(videoName).digest("hex").slice(0, 12);
  const suffix = region ? "_bbox" : "";
  const outputName = `${hash}_${seconds}${suffix}.jpg`;
  const outputPath = resolve(FRAMES_DIR, outputName);

  await mkdir(FRAMES_DIR, { recursive: true });

  const vfFilters: string[] = [];
  if (region) {
    // drawbox using normalized coordinates (iw/ih)
    vfFilters.push(
      `drawbox=x=iw*${region.x}:y=ih*${region.y}:w=iw*${region.w}:h=ih*${region.h}:color=red@0.8:t=3`,
    );
  }

  const ffmpegArgs = [
    "ffmpeg",
    "-ss",
    String(seconds),
    "-i",
    videoPath,
    ...(vfFilters.length > 0 ? ["-vf", vfFilters.join(",")] : []),
    "-frames:v",
    "1",
    "-q:v",
    "2",
    "-update",
    "1",
    "-y",
    outputPath,
  ];

  const proc = Bun.spawn(ffmpegArgs, { stdout: "pipe", stderr: "pipe" });
  const exitCode = await proc.exited;

  if (exitCode !== 0) {
    const stderr = await new Response(proc.stderr).text();
    console.error(
      `ffmpeg failed (exit ${exitCode}): ${stderr.trim().split("\n").pop()}`,
    );
    process.exit(1);
  }

  console.log(
    JSON.stringify(
      {
        type: "image",
        path: `data/tmp/frames/${outputName}`,
        seconds,
        region: region ?? undefined,
      },
      null,
      2,
    ),
  );
}
