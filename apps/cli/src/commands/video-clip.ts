/**
 * video-clip command: extracts a clip from a video and saves it as an MP4.
 *
 * Usage: ee video-clip <file> --start <sec> [--end <sec>] [--region x,y,w,h]
 *
 * The clip is saved to data/tmp/clips/ and the path is printed as JSON so the
 * frontend can render an inline video player. The file persists so the agent
 * can pass it to other commands (e.g. video-analyze).
 *
 * Requires ffmpeg to be installed.
 */
import { createHash } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { getFlag, getPositionals } from "../args.js";
import { CLIPS_DIR, PROJECT_ROOT } from "../paths.js";

interface Region {
  x: number;
  y: number;
  w: number;
  h: number;
}

export default async function videoClip(args: string[]): Promise<void> {
  const positionals = getPositionals(args);
  const filePath = positionals[0];
  const startRaw = getFlag(args, "start");
  const endRaw = getFlag(args, "end");
  const regionRaw = getFlag(args, "region");

  if (!filePath || startRaw == null) {
    console.error(
      "Usage: ee video-clip <file> --start <sec> [--end <sec>] [--region x,y,w,h]",
    );
    process.exit(1);
  }

  const startSec = parseFloat(startRaw);
  if (!Number.isFinite(startSec) || startSec < 0) {
    console.error(
      `Invalid --start: "${startRaw}". Expected a non-negative number.`,
    );
    process.exit(1);
  }

  let endSec: number | undefined;
  if (endRaw != null) {
    endSec = parseFloat(endRaw);
    if (!Number.isFinite(endSec) || endSec <= startSec) {
      console.error(
        `Invalid --end: "${endRaw}". Must be a number greater than --start.`,
      );
      process.exit(1);
    }
  }

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

  const absolutePath = filePath.startsWith("/")
    ? filePath
    : resolve(PROJECT_ROOT, filePath);

  await mkdir(CLIPS_DIR, { recursive: true });

  const hash = createHash("sha1")
    .update(basename(absolutePath))
    .digest("hex")
    .slice(0, 8);
  const suffix = region ? "_bbox" : "";
  const clipName = `clip_${hash}_${startSec}-${endSec ?? "end"}${suffix}.mp4`;
  const clipPath = resolve(CLIPS_DIR, clipName);

  const ffmpegArgs: string[] = [
    "ffmpeg",
    "-y",
    "-ss",
    String(startSec),
    "-i",
    absolutePath,
    ...(endSec != null ? ["-t", String(endSec - startSec)] : []),
  ];

  if (region) {
    ffmpegArgs.push(
      "-vf",
      `drawbox=x=iw*${region.x}:y=ih*${region.y}:w=iw*${region.w}:h=ih*${region.h}:color=red@0.8:t=3`,
    );
  }

  // Always re-encode to H.264 for browser compatibility (source videos may use
  // codecs like MPEG-4 Part 2 that browsers cannot play).
  ffmpegArgs.push(
    "-c:v",
    "libx264",
    "-preset",
    "ultrafast",
    "-pix_fmt",
    "yuv420p",
    "-an",
  );

  ffmpegArgs.push(clipPath);

  const proc = Bun.spawn(ffmpegArgs, { stdout: "pipe", stderr: "pipe" });
  const exitCode = await proc.exited;

  if (exitCode !== 0) {
    const stderr = await new Response(proc.stderr).text();
    console.error(
      `ffmpeg failed (exit ${exitCode}): ${stderr.trim().split("\n").pop()}`,
    );
    process.exit(1);
  }

  const relativePath = `data/tmp/clips/${clipName}`;
  console.log(
    JSON.stringify(
      {
        type: "clip",
        path: relativePath,
        startSec,
        endSec: endSec ?? undefined,
        region: region ?? undefined,
      },
      null,
      2,
    ),
  );
}
