/**
 * tutorial-render command: reads a script JSON and renders it into an MP4 using ffmpeg.
 *
 * Usage: ee tutorial-render <slug>
 *
 * Reads from data/tutorials/<slug>/config.json
 * Outputs to data/tutorials/<slug>/video.mp4
 *
 * Step types:
 *   narrate / takeaway / root-cause / impact — video-bg card with tinted overlay + centered text
 *   play               — trimmed clip from source video with lower-third label bar
 *   pause              — single frame with bounding box + annotation text
 *
 * Visual effects:
 *   - Crossfade (xfade) transitions between all segments
 *   - Video frame backgrounds on text cards (dimmed + tinted with Ken Burns)
 *   - Staggered text reveal on text cards (lines appear one by one)
 *   - Type labels on root-cause / impact / takeaway cards
 *   - Ken Burns (zoompan) on pause frames
 *   - Spotlight dimming + border on pause bounding boxes
 *   - Centered lower-third label bar on play clips
 *   - Subtle vignette on play clips
 *   - Text shadows for readability
 *   - Fade from/to black at video start/end
 *   - Optional slow-motion on play clips (slowMo field)
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

/* ── Constants ─────────────────────────────────────────────────────────────── */

const LINE_HEIGHT = 48;
const FONT = "Arial";
const MAX_TUTORIAL_DURATION_SEC = 40;

/** Crossfade duration between segments (seconds). */
const XFADE_DURATION = 0.3;

/** Delay before the first text line appears on a card (seconds). */
const TEXT_STAGGER_START = 0.15;

/** Additional delay per subsequent text line (seconds). */
const TEXT_STAGGER_STEP = 0.12;

/** Ken Burns max zoom on pause frames and text-card backgrounds (1.05 = 5%). */
const ZOOM_AMOUNT = 1.05;

/** Delay before bounding box appears on a pause frame (seconds). */
const PAUSE_BOX_DELAY = 0.3;

/** Delay before annotation text appears on a pause frame (seconds). */
const PAUSE_TEXT_DELAY = 0.5;

/** Fade in/out duration at the start and end of the video (seconds). */
const FADE_DURATION = 0.5;

/** Text shadow parameters for readability on video backgrounds. */
const SHADOW = "shadowcolor=black@0.7:shadowx=3:shadowy=3";

/* ── Duration helpers ──────────────────────────────────────────────────────── */

/** Compute the effective output duration of a step. */
function computeStepDuration(step: Step): number {
  switch (step.type) {
    case "narrate":
    case "takeaway":
      return (
        step.durationSec ??
        Math.min(8, Math.max(2, Math.ceil(step.text.length / 20)))
      );
    case "play": {
      if (step.durationSec) return step.durationSec;
      const clipDur = Math.max(1, Math.min(step.endSec - step.startSec, 40));
      return step.slowMo ? clipDur / step.slowMo : clipDur;
    }
    case "pause":
      return (
        step.durationSec ??
        Math.min(8, Math.max(3, Math.ceil(step.description.length / 20)))
      );
    case "root-cause":
    case "impact":
      return (
        step.durationSec ??
        Math.min(8, Math.max(2, Math.ceil(step.text.length / 20)))
      );
  }
}

/* ── Background source mapping ─────────────────────────────────────────────── */

interface BgSource {
  video: string;
  timestampSec: number;
}

/**
 * For each text-card step, find the nearest play/pause step to use as a
 * video background frame. Text cards before a play step use startSec
 * (preview), after use endSec-1 (continuation). Returns undefined for
 * play/pause steps (they already have their own video).
 */
function findBgSources(steps: Step[]): (BgSource | undefined)[] {
  return steps.map((step, i) => {
    if (step.type === "play" || step.type === "pause") return undefined;

    let bestDist = Infinity;
    let bestSource: BgSource | undefined;

    for (let j = 0; j < steps.length; j++) {
      const other = steps[j];
      const dist = Math.abs(j - i);
      if (dist >= bestDist) continue;

      if (other.type === "play") {
        bestDist = dist;
        bestSource = {
          video: other.video,
          timestampSec: j < i ? Math.max(0, other.endSec - 1) : other.startSec,
        };
      } else if (other.type === "pause") {
        bestDist = dist;
        bestSource = {
          video: other.video,
          timestampSec: other.timestampSec,
        };
      }
    }

    return bestSource;
  });
}

/* ── Text helpers ──────────────────────────────────────────────────────────── */

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
 * Build drawtext filters for centered multi-line text with staggered reveal.
 * Each line appears TEXT_STAGGER_STEP seconds after the previous.
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
    const delay = TEXT_STAGGER_START + i * TEXT_STAGGER_STEP;
    return [
      `drawtext=text='${esc(line)}'`,
      `font=${FONT}`,
      `fontcolor=${fontColor}`,
      `fontsize=${fontSize}`,
      SHADOW,
      "x=(w-text_w)/2",
      `y=${yExpr}`,
      `enable='gte(t,${delay.toFixed(2)})'`,
    ].join(":");
  });
}

/**
 * Build a full-width semi-transparent bar at the bottom with centered text lines.
 * Matches the play-clip lower-third style for visual consistency.
 */
function bottomBarFilters(
  lines: string[],
  fontSize: number,
  enableDelay?: number,
): string[] {
  const lineHeight = fontSize + 12;
  const padding = 14;
  const barHeight = lines.length * lineHeight + padding * 2;
  const en =
    enableDelay !== undefined
      ? `:enable='gte(t,${enableDelay.toFixed(2)})'`
      : "";

  const filters: string[] = [];

  // Full-width bar
  filters.push(
    `drawbox=x=0:y=h-${barHeight}:w=iw:h=${barHeight}:color=black@0.55:t=fill${en}`,
  );

  // Centered text lines inside the bar
  for (let i = 0; i < lines.length; i++) {
    const yVal = barHeight - padding - i * lineHeight;
    filters.push(
      [
        `drawtext=text='${esc(lines[i])}'`,
        `font=${FONT}`,
        "fontcolor=white",
        `fontsize=${fontSize}`,
        SHADOW,
        "x=(w-text_w)/2",
        `y=h-${yVal}`,
        en ? `enable='gte(t,${enableDelay!.toFixed(2)})'` : "",
      ]
        .filter(Boolean)
        .join(":"),
    );
  }

  return filters;
}

/** Small uppercase label at the top of root-cause / impact / takeaway cards. */
function typeLabelFilter(style: "root-cause" | "impact" | "takeaway"): string {
  const labels: Record<string, string> = {
    "root-cause": "ROOT CAUSE",
    impact: "IMPACT",
    takeaway: "TAKEAWAY",
  };
  return [
    `drawtext=text='${labels[style]}'`,
    `font=${FONT}`,
    "fontcolor=white@0.4",
    "fontsize=18",
    SHADOW,
    "x=(w-text_w)/2",
    "y=40",
    `enable='gte(t,0.08)'`,
  ].join(":");
}

/* ── Step renderers ────────────────────────────────────────────────────────── */

/**
 * Render a text card. When a bgSource is available, uses a dimmed + tinted
 * video frame with Ken Burns zoom as the background. Falls back to a solid
 * color card when no source video is available.
 */
async function renderTextCard(
  outputPath: string,
  text: string,
  style: "narrate" | "takeaway" | "root-cause" | "impact",
  overrideDuration?: number,
  bgSource?: BgSource,
): Promise<void> {
  const duration =
    overrideDuration ?? Math.min(8, Math.max(2, Math.ceil(text.length / 20)));

  const tintColor =
    style === "takeaway"
      ? "0xe65100"
      : style === "root-cause"
        ? "0xb71c1c"
        : style === "impact"
          ? "0x00695c"
          : "0x1a237e";
  const tintAlpha = style === "takeaway" ? 0.65 : 0.6;

  const fontColor = "white";
  const fontSize = 32;
  const lines = wrapLines(text, 45);
  const textFilters = centeredTextFilters(lines, fontSize, fontColor);

  // ─ Video background path ──────────────────────────────────────────────
  if (bgSource) {
    const videoPath = resolve(VIDEOS_DIR, bgSource.video);
    if (existsSync(videoPath)) {
      const framePath = outputPath.replace(".mp4", "_bg.jpg");
      await runFFmpeg([
        "ffmpeg",
        "-y",
        "-ss",
        String(bgSource.timestampSec),
        "-i",
        videoPath,
        "-frames:v",
        "1",
        "-vf",
        "scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:-1:-1:color=black",
        "-q:v",
        "2",
        "-update",
        "1",
        framePath,
      ]);

      const totalFrames = Math.ceil(duration * 30);
      const zoomIncrement = ((ZOOM_AMOUNT - 1) / totalFrames).toFixed(6);

      const vfParts: string[] = [
        // Ken Burns slow zoom on still frame
        `zoompan=z='min(zoom+${zoomIncrement},${ZOOM_AMOUNT})':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${totalFrames}:s=1280x720:fps=30`,
        // Dim and desaturate to push video into background
        "eq=brightness=-0.4:saturation=0.4",
        // Colored tint overlay
        `drawbox=x=0:y=0:w=iw:h=ih:color=${tintColor}@${tintAlpha}:t=fill`,
      ];

      if (style !== "narrate") {
        vfParts.push(typeLabelFilter(style));
      }
      vfParts.push(...textFilters);

      await runFFmpeg([
        "ffmpeg",
        "-y",
        "-i",
        framePath,
        "-vf",
        vfParts.join(","),
        "-c:v",
        "libx264",
        "-preset",
        "ultrafast",
        "-pix_fmt",
        "yuv420p",
        outputPath,
      ]);

      await unlink(framePath).catch(() => {});
      return;
    }
  }

  // ─ Fallback: solid color background ───────────────────────────────────
  const vfParts: string[] = [];
  if (style !== "narrate") {
    vfParts.push(typeLabelFilter(style));
  }
  vfParts.push(...textFilters);

  await runFFmpeg([
    "ffmpeg",
    "-y",
    "-f",
    "lavfi",
    "-i",
    `color=c=${tintColor}:s=1280x720:d=${duration}:r=30`,
    "-vf",
    vfParts.join(","),
    "-c:v",
    "libx264",
    "-preset",
    "ultrafast",
    "-tune",
    "stillimage",
    "-pix_fmt",
    "yuv420p",
    outputPath,
  ]);
}

/** Render a play step — trim clip with vignette, centered lower-third label, and optional slow-mo. */
async function renderPlayStep(
  outputPath: string,
  step: PlayStep,
): Promise<void> {
  const videoPath = resolve(VIDEOS_DIR, step.video);
  if (!existsSync(videoPath)) {
    console.error(`    Video not found: ${step.video}`);
    process.exit(1);
  }

  const clipDuration = Math.max(1, Math.min(step.endSec - step.startSec, 40));
  const ptsMultiplier = step.slowMo ? 1 / step.slowMo : 1;

  const vfParts: string[] = [
    "scale=1280:720:force_original_aspect_ratio=decrease",
    "pad=1280:720:-1:-1:color=black",
  ];

  // Slow-motion via PTS manipulation
  if (ptsMultiplier !== 1) {
    vfParts.push(`setpts=${ptsMultiplier.toFixed(4)}*PTS`);
  }

  // Normalize to 30fps (source videos may vary) + subtle vignette
  vfParts.push("fps=30");
  vfParts.push("vignette=PI/4");

  if (step.label) {
    // Full-width semi-transparent lower-third bar + centered label
    vfParts.push("drawbox=x=0:y=h-70:w=iw:h=70:color=black@0.55:t=fill");
    vfParts.push(
      [
        `drawtext=text='${esc(step.label)}'`,
        `font=${FONT}`,
        "fontcolor=white",
        "fontsize=26",
        SHADOW,
        "x=(w-text_w)/2",
        "y=h-48",
      ].join(":"),
    );
  }

  // Use -ss/-t as input options to control source reading
  const ffmpegArgs = [
    "ffmpeg",
    "-y",
    "-ss",
    String(step.startSec),
    "-t",
    String(clipDuration),
    "-i",
    videoPath,
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

/**
 * Render a pause step — Ken Burns zoom on a still frame with glow bounding box
 * and delayed annotation text.
 */
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
    Math.min(8, Math.max(3, Math.ceil(step.description.length / 20)));

  // 1. Extract clean frame (scale + pad only, no annotations)
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
    "scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:-1:-1:color=black",
    "-q:v",
    "2",
    "-update",
    "1",
    framePath,
  ];
  await runFFmpeg(extractArgs);

  // 2. Ken Burns zoom + annotations via zoompan → drawbox → drawtext
  const totalFrames = Math.ceil(holdDuration * 30);
  const zoomIncrement = ((ZOOM_AMOUNT - 1) / totalFrames).toFixed(6);

  const vfParts: string[] = [
    `zoompan=z='min(zoom+${zoomIncrement},${ZOOM_AMOUNT})':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${totalFrames}:s=1280x720:fps=30`,
  ];

  // Spotlight: dim everything outside the bounding box, then draw crisp border
  if (step.region) {
    const { x, y, w, h } = step.region;
    const en = `enable='gte(t,${PAUSE_BOX_DELAY.toFixed(2)})'`;
    const yBottom = (y + h).toFixed(4);
    const xRight = (x + w).toFixed(4);
    const hBottom = (1 - y - h).toFixed(4);
    const wRight = (1 - x - w).toFixed(4);
    // Top bar
    vfParts.push(
      `drawbox=x=0:y=0:w=iw:h=ih*${y}:color=black@0.55:t=fill:${en}`,
    );
    // Bottom bar
    vfParts.push(
      `drawbox=x=0:y=ih*${yBottom}:w=iw:h=ih*${hBottom}:color=black@0.55:t=fill:${en}`,
    );
    // Left bar
    vfParts.push(
      `drawbox=x=0:y=ih*${y}:w=iw*${x}:h=ih*${h}:color=black@0.55:t=fill:${en}`,
    );
    // Right bar
    vfParts.push(
      `drawbox=x=iw*${xRight}:y=ih*${y}:w=iw*${wRight}:h=ih*${h}:color=black@0.55:t=fill:${en}`,
    );
    // Crisp red border around the spotlight region
    vfParts.push(
      `drawbox=x=iw*${x}:y=ih*${y}:w=iw*${w}:h=ih*${h}:color=red@0.9:t=4:${en}`,
    );
  }

  // Bottom annotation text — delayed after box
  const lines = wrapLines(step.description, 60);
  const descFilters = bottomBarFilters(lines, 24, PAUSE_TEXT_DELAY);
  vfParts.push(...descFilters);

  const renderArgs = [
    "ffmpeg",
    "-y",
    "-i",
    framePath,
    "-vf",
    vfParts.join(","),
    "-c:v",
    "libx264",
    "-preset",
    "ultrafast",
    "-pix_fmt",
    "yuv420p",
    outputPath,
  ];
  await runFFmpeg(renderArgs);

  await unlink(framePath).catch(() => {});
}

/* ── Crossfade concatenation ───────────────────────────────────────────────── */

/**
 * Concatenate segments with xfade crossfade transitions.
 * Falls back to simple copy for a single segment.
 */
async function concatWithXfade(
  segmentPaths: string[],
  segmentDurations: number[],
  outputPath: string,
): Promise<void> {
  if (segmentPaths.length === 1) {
    const dur = segmentDurations[0];
    const fadeOutStart = Math.max(0, dur - FADE_DURATION);
    await runFFmpeg([
      "ffmpeg",
      "-y",
      "-i",
      segmentPaths[0],
      "-vf",
      `fade=t=in:st=0:d=${FADE_DURATION},fade=t=out:st=${fadeOutStart.toFixed(3)}:d=${FADE_DURATION}`,
      "-c:v",
      "libx264",
      "-preset",
      "fast",
      "-pix_fmt",
      "yuv420p",
      "-movflags",
      "+faststart",
      outputPath,
    ]);
    return;
  }

  // Build input flags
  const inputs: string[] = [];
  for (const p of segmentPaths) {
    inputs.push("-i", p);
  }

  // Build xfade filter chain
  const filterParts: string[] = [];
  let prevLabel = "0:v";
  let cumulativeDuration = segmentDurations[0];

  for (let i = 0; i < segmentPaths.length - 1; i++) {
    const offset = Math.max(0, cumulativeDuration - XFADE_DURATION);
    const isLast = i === segmentPaths.length - 2;
    const outLabel = isLast ? "vxfade" : `v${i}`;
    filterParts.push(
      `[${prevLabel}][${i + 1}:v]xfade=transition=fade:duration=${XFADE_DURATION}:offset=${offset.toFixed(3)}[${outLabel}]`,
    );
    prevLabel = outLabel;
    cumulativeDuration = offset + segmentDurations[i + 1];
  }

  // Fade from black at start, fade to black at end
  const fadeOutStart = Math.max(0, cumulativeDuration - FADE_DURATION);
  filterParts.push(
    `[vxfade]fade=t=in:st=0:d=${FADE_DURATION},fade=t=out:st=${fadeOutStart.toFixed(3)}:d=${FADE_DURATION}[vout]`,
  );

  const filterComplex = filterParts.join(";");

  const args = [
    "ffmpeg",
    "-y",
    ...inputs,
    "-filter_complex",
    filterComplex,
    "-map",
    "[vout]",
    "-c:v",
    "libx264",
    "-preset",
    "fast",
    "-crf",
    "20",
    "-pix_fmt",
    "yuv420p",
    "-movflags",
    "+faststart",
    outputPath,
  ];
  await runFFmpeg(args);
}

/* ── Main entry point ──────────────────────────────────────────────────────── */

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

  // Pre-flight duration check (raw step durations, before xfade shortening)
  const stepDurations = script.steps.map(computeStepDuration);
  const totalDuration = stepDurations.reduce((sum, d) => sum + d, 0);
  if (totalDuration > MAX_TUTORIAL_DURATION_SEC) {
    console.error(
      `Tutorial duration ${totalDuration.toFixed(1)}s exceeds ${MAX_TUTORIAL_DURATION_SEC}s limit. Reduce steps or shorten text/clips.`,
    );
    process.exit(1);
  }

  await mkdir(TMP_DIR, { recursive: true });

  const segmentPaths: string[] = [];
  const segmentDurations: number[] = [];
  const segmentDir = resolve(TMP_DIR, `_render_${slug}`);
  await mkdir(segmentDir, { recursive: true });

  // Map text cards to their nearest play/pause video source for backgrounds
  const bgSources = findBgSources(script.steps);

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
          bgSources[i],
        );
        break;
      case "takeaway":
        await renderTextCard(
          segmentPath,
          step.text,
          "takeaway",
          step.durationSec,
          bgSources[i],
        );
        break;
      case "root-cause":
        await renderTextCard(
          segmentPath,
          step.text,
          "root-cause",
          step.durationSec,
          bgSources[i],
        );
        break;
      case "impact":
        await renderTextCard(
          segmentPath,
          step.text,
          "impact",
          step.durationSec,
          bgSources[i],
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
    segmentDurations.push(stepDurations[i]);
  }

  if (segmentPaths.length === 0) {
    console.error("No segments rendered.");
    process.exit(1);
  }

  // Concatenate with crossfade transitions
  const tutorialDir = resolve(TUTORIALS_DIR, slug);
  const outputPath = resolve(tutorialDir, "video.mp4");
  console.error("  Compositing with crossfade transitions...");
  await concatWithXfade(segmentPaths, segmentDurations, outputPath);

  // Clean up segment files
  for (const p of segmentPaths) {
    await unlink(p).catch(() => {});
  }
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

  // Actual output duration accounts for xfade overlap
  const xfadeOverlap =
    segmentPaths.length > 1 ? (segmentPaths.length - 1) * XFADE_DURATION : 0;
  const outputDuration = totalDuration - xfadeOverlap;

  // Write meta.json
  const meta = {
    id: slug,
    title: script.title ?? slug,
    description: script.description ?? "",
    generatedAt: script.generatedAt ?? new Date().toISOString(),
    videoPath: `data/tutorials/${slug}/video.mp4`,
    thumbnailPath: `data/tutorials/${slug}/thumb.jpg`,
    configHash,
    durationSec: Math.round(outputDuration * 10) / 10,
  };
  await writeFile(metaPath, JSON.stringify(meta, null, 2));
  console.error(`  \u2713 meta.json written`);

  console.log(
    JSON.stringify({
      type: "clip",
      path: `data/tutorials/${slug}/video.mp4`,
      durationSec: Math.round(outputDuration * 10) / 10,
    }),
  );
}

/* ── ffmpeg runner ─────────────────────────────────────────────────────────── */

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
