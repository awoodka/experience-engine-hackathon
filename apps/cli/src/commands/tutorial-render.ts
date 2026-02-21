/**
 * tutorial-render command: reads a script JSON and renders it into an MP4 using ffmpeg.
 *
 * Usage: ee tutorial-render <slug>
 *
 * Reads from data/tutorials/<slug>/config.json
 * Outputs to data/tmp/<slug>.mp4
 *
 * Step types:
 *   narrate / takeaway — solid color card with centered text overlay
 *   play               — trimmed clip from source video with label bar
 *   pause              — single frame with bounding box + annotation text
 */
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { TUTORIALS_DIR, VIDEOS_DIR, TMP_DIR } from "../paths.js";
import type {
  Step,
  PlayStep,
  PauseStep,
  TutorialScript,
} from "../lib/tutorial-types.js";

const LINE_HEIGHT = 44;
const FONT = "Arial";
const MAX_TUTORIAL_DURATION_SEC = 20;

/** Compute the effective duration of a step (mirrors validate-tutorials logic). */
function computeStepDuration(step: Step): number {
  switch (step.type) {
    case "narrate":
    case "takeaway":
      return (
        step.durationSec ??
        Math.min(5, Math.max(2, Math.ceil(step.text.length / 20)))
      );
    case "play":
      return (
        step.durationSec ??
        Math.max(1, Math.min(step.endSec - step.startSec, 20))
      );
    case "pause":
      return (
        step.durationSec ??
        Math.min(4, Math.max(2, Math.ceil(step.description.length / 30)))
      );
  }
}

/** Escape text for ffmpeg drawtext text= parameter. */
function esc(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\u2019")
    .replace(/:/g, "\\:")
    .replace(/%/g, "%%")
    .replace(/\[/g, "\\[")
    .replace(/]/g, "\\]");
}

/** Word-wrap text into lines that fit maxChars. */
function wrapLines(text: string, maxChars: number): string[] {
  const words = text.split(" ");
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    if (current.length + word.length + 1 > maxChars && current.length > 0) {
      lines.push(current);
      current = word;
    } else {
      current = current ? `${current} ${word}` : word;
    }
  }
  if (current) lines.push(current);
  return lines;
}

/**
 * Build drawtext filters for centered multi-line text.
 * Each line gets its own drawtext filter to avoid the newline-glyph bug.
 */
function centeredTextFilters(
  lines: string[],
  fontSize: number,
  fontColor: string,
): string[] {
  const totalHeight = lines.length * LINE_HEIGHT;
  return lines.map((line, i) => {
    const yOffset = -totalHeight / 2 + i * LINE_HEIGHT;
    const yExpr =
      yOffset >= 0 ? `(h/2)+${yOffset}` : `(h/2)-${Math.abs(yOffset)}`;
    return [
      `drawtext=text='${esc(line)}'`,
      `font=${FONT}`,
      `fontcolor=${fontColor}`,
      `fontsize=${fontSize}`,
      "x=(w-text_w)/2",
      `y=${yExpr}`,
    ].join(":");
  });
}

/**
 * Build drawtext filters for bottom-anchored multi-line text with a box background.
 */
function bottomTextFilters(
  lines: string[],
  fontSize: number,
  bottomMargin: number,
): string[] {
  return lines.map((line, i) => {
    const lineHeight = fontSize + 10;
    const yFromBottom = bottomMargin + (lines.length - 1 - i) * lineHeight;
    return [
      `drawtext=text='${esc(line)}'`,
      `font=${FONT}`,
      "fontcolor=white",
      `fontsize=${fontSize}`,
      "x=(w-text_w)/2",
      `y=h-${yFromBottom}`,
      "box=1",
      "boxcolor=black@0.7",
      "boxborderw=8",
    ].join(":");
  });
}

export default async function scriptRender(args: string[]): Promise<void> {
  const slug = args[0];
  if (!slug) {
    console.error("Usage: ee tutorial-render <slug>");
    process.exit(1);
  }

  const scriptPath = resolve(TUTORIALS_DIR, slug, "config.json");
  if (!existsSync(scriptPath)) {
    console.error(`Script not found: data/tutorials/${slug}/config.json`);
    process.exit(1);
  }

  let script: TutorialScript;
  try {
    script = JSON.parse(await readFile(scriptPath, "utf8"));
  } catch {
    console.error(`Failed to parse script JSON: ${slug}.json`);
    process.exit(1);
  }

  if (!script.steps || script.steps.length === 0) {
    console.error("Script has no steps.");
    process.exit(1);
  }

  // Pre-flight duration check
  const totalDuration = script.steps.reduce(
    (sum, s) => sum + computeStepDuration(s),
    0,
  );
  if (totalDuration > MAX_TUTORIAL_DURATION_SEC) {
    console.error(
      `Tutorial duration ${totalDuration.toFixed(1)}s exceeds ${MAX_TUTORIAL_DURATION_SEC}s limit. Reduce steps or shorten text/clips.`,
    );
    process.exit(1);
  }

  await mkdir(TMP_DIR, { recursive: true });

  const segmentPaths: string[] = [];
  const segmentDir = resolve(TMP_DIR, `_render_${slug}`);
  await mkdir(segmentDir, { recursive: true });

  console.error(`Rendering ${script.steps.length} steps...`);

  for (let i = 0; i < script.steps.length; i++) {
    const step = script.steps[i];
    const segmentPath = resolve(
      segmentDir,
      `seg_${String(i).padStart(3, "0")}.mp4`,
    );
    console.error(`  [${i + 1}/${script.steps.length}] ${step.type}`);

    switch (step.type) {
      case "narrate":
        await renderTextCard(
          segmentPath,
          step.text,
          "narrate",
          step.durationSec,
        );
        break;
      case "takeaway":
        await renderTextCard(
          segmentPath,
          step.text,
          "takeaway",
          step.durationSec,
        );
        break;
      case "play":
        await renderPlayStep(segmentPath, step);
        break;
      case "pause":
        await renderPauseStep(segmentPath, step);
        break;
      default:
        console.error(`  Unknown step type: ${(step as Step).type}, skipping`);
        continue;
    }

    segmentPaths.push(segmentPath);
  }

  if (segmentPaths.length === 0) {
    console.error("No segments rendered.");
    process.exit(1);
  }

  // Write concat list
  const concatListPath = resolve(segmentDir, "concat.txt");
  const concatContent = segmentPaths.map((p) => `file '${p}'`).join("\n");
  await Bun.write(concatListPath, concatContent);

  // Concatenate all segments directly into the tutorial directory
  const tutorialDir = resolve(TUTORIALS_DIR, slug);
  const outputPath = resolve(tutorialDir, "video.mp4");
  const concatArgs = [
    "ffmpeg",
    "-y",
    "-f",
    "concat",
    "-safe",
    "0",
    "-i",
    concatListPath,
    "-c",
    "copy",
    "-movflags",
    "+faststart",
    outputPath,
  ];

  const concatProc = Bun.spawn(concatArgs, { stdout: "pipe", stderr: "pipe" });
  const concatExit = await concatProc.exited;
  if (concatExit !== 0) {
    const stderr = await new Response(concatProc.stderr).text();
    console.error(`Concat failed: ${stderr.trim().split("\n").pop()}`);
    process.exit(1);
  }

  // Clean up segment files
  for (const p of segmentPaths) {
    await unlink(p).catch(() => {});
  }
  await unlink(concatListPath).catch(() => {});
  await unlink(segmentDir).catch(() => {});

  // --- Finalize: thumbnail + meta.json ---
  const destThumbPath = resolve(tutorialDir, "thumb.jpg");
  const metaPath = resolve(tutorialDir, "meta.json");

  // Extract thumbnail (first frame of rendered video)
  const thumbArgs = [
    "ffmpeg",
    "-y",
    "-ss",
    "0",
    "-i",
    outputPath,
    "-frames:v",
    "1",
    "-q:v",
    "3",
    "-update",
    "1",
    destThumbPath,
  ];
  const thumbProc = Bun.spawn(thumbArgs, { stdout: "pipe", stderr: "pipe" });
  await thumbProc.exited;

  // Compute config hash
  const configRaw = await readFile(scriptPath, "utf8");
  const configHash = createHash("sha256")
    .update(configRaw)
    .digest("hex")
    .slice(0, 12);

  // Write meta.json
  const meta = {
    id: slug,
    title: script.title ?? slug,
    description: script.description ?? "",
    generatedAt: script.generatedAt ?? new Date().toISOString(),
    videoPath: `data/tutorials/${slug}/video.mp4`,
    thumbnailPath: `data/tutorials/${slug}/thumb.jpg`,
    configHash,
    durationSec: totalDuration,
  };
  await writeFile(metaPath, JSON.stringify(meta, null, 2));
  console.error(`  ✓ meta.json written`);

  console.log(
    JSON.stringify({
      type: "clip",
      path: `data/tutorials/${slug}/video.mp4`,
      durationSec: totalDuration,
    }),
  );
}

/** Render a text card with centered multi-line text. */
async function renderTextCard(
  outputPath: string,
  text: string,
  style: "narrate" | "takeaway",
  overrideDuration?: number,
): Promise<void> {
  const duration =
    overrideDuration ?? Math.min(5, Math.max(2, Math.ceil(text.length / 20)));
  const bgColor = style === "takeaway" ? "0x1a1a2e" : "0x212121";
  const fontColor = style === "takeaway" ? "0x4fc3f7" : "white";
  const fontSize = style === "takeaway" ? 34 : 30;
  const lines = wrapLines(text, 50);
  const textFilters = centeredTextFilters(lines, fontSize, fontColor);

  const vf = textFilters.join(",");

  const ffmpegArgs = [
    "ffmpeg",
    "-y",
    "-f",
    "lavfi",
    "-i",
    `color=c=${bgColor}:s=1280x720:d=${duration}:r=30`,
    "-vf",
    vf,
    "-c:v",
    "libx264",
    "-preset",
    "ultrafast",
    "-tune",
    "stillimage",
    "-pix_fmt",
    "yuv420p",
    outputPath,
  ];

  await runFFmpeg(ffmpegArgs);
}

/** Render a play step — trim clip with optional label. */
async function renderPlayStep(
  outputPath: string,
  step: PlayStep,
): Promise<void> {
  const videoPath = resolve(VIDEOS_DIR, step.video);
  if (!existsSync(videoPath)) {
    console.error(`    Video not found: ${step.video}`);
    process.exit(1);
  }

  const duration =
    step.durationSec ?? Math.max(1, Math.min(step.endSec - step.startSec, 20));
  const vfParts: string[] = [
    "scale=1280:720:force_original_aspect_ratio=decrease",
    "pad=1280:720:-1:-1:color=black",
  ];

  if (step.label) {
    vfParts.push(
      [
        `drawtext=text='${esc(step.label)}'`,
        `font=${FONT}`,
        "fontcolor=white",
        "fontsize=28",
        "x=20",
        "y=h-60",
        "box=1",
        "boxcolor=black@0.6",
        "boxborderw=8",
      ].join(":"),
    );
  }

  const ffmpegArgs = [
    "ffmpeg",
    "-y",
    "-ss",
    String(step.startSec),
    "-i",
    videoPath,
    "-t",
    String(duration),
    "-vf",
    vfParts.join(","),
    "-c:v",
    "libx264",
    "-preset",
    "ultrafast",
    "-pix_fmt",
    "yuv420p",
    "-an",
    outputPath,
  ];

  await runFFmpeg(ffmpegArgs);
}

/** Render a pause step — frame with bounding box + annotation text. */
async function renderPauseStep(
  outputPath: string,
  step: PauseStep,
): Promise<void> {
  const videoPath = resolve(VIDEOS_DIR, step.video);
  if (!existsSync(videoPath)) {
    console.error(`    Video not found: ${step.video}`);
    process.exit(1);
  }

  const holdDuration =
    step.durationSec ??
    Math.min(4, Math.max(2, Math.ceil(step.description.length / 30)));
  const vfParts: string[] = [
    "scale=1280:720:force_original_aspect_ratio=decrease",
    "pad=1280:720:-1:-1:color=black",
  ];

  if (step.region) {
    const { x, y, w, h } = step.region;
    vfParts.push(
      `drawbox=x=iw*${x}:y=ih*${y}:w=iw*${w}:h=ih*${h}:color=red@0.8:t=3`,
    );
  }

  // Add description lines at bottom
  const lines = wrapLines(step.description, 60);
  const descFilters = bottomTextFilters(lines, 22, 30);
  vfParts.push(...descFilters);

  // Extract annotated frame
  const framePath = outputPath.replace(".mp4", "_frame.jpg");
  const extractArgs = [
    "ffmpeg",
    "-y",
    "-ss",
    String(step.timestampSec),
    "-i",
    videoPath,
    "-frames:v",
    "1",
    "-vf",
    vfParts.join(","),
    "-q:v",
    "2",
    "-update",
    "1",
    framePath,
  ];
  await runFFmpeg(extractArgs);

  // Turn frame into video
  const frameToVideoArgs = [
    "ffmpeg",
    "-y",
    "-loop",
    "1",
    "-i",
    framePath,
    "-t",
    String(holdDuration),
    "-vf",
    "scale=1280:720",
    "-c:v",
    "libx264",
    "-preset",
    "ultrafast",
    "-tune",
    "stillimage",
    "-pix_fmt",
    "yuv420p",
    "-r",
    "30",
    outputPath,
  ];
  await runFFmpeg(frameToVideoArgs);

  await unlink(framePath).catch(() => {});
}

async function runFFmpeg(args: string[]): Promise<void> {
  const proc = Bun.spawn(args, { stdout: "pipe", stderr: "pipe" });
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    const stderr = await new Response(proc.stderr).text();
    const lastLine = stderr.trim().split("\n").pop() ?? "";
    console.error(`    ffmpeg error: ${lastLine}`);
    process.exit(1);
  }
}
