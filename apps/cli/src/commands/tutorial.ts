/**
 * Tutorial render command: converts a step-based tutorial script to an MP4.
 *
 * Usage: ./ee tutorial render <id> [--model <gemini-model>]
 *
 * Reads:  data/tutorials/scripts/<id>.json
 * Writes: data/tutorials/videos/<id>.mp4
 *         data/tutorials/videos/<id>.thumb.jpg
 *         data/tutorials/videos/<id>.meta.json
 *
 * Step types in the JSON:
 *   narrate  — text card on dark background
 *   play     — raw video clip (startSec → endSec), optional label caption
 *   pause    — freeze frame with amber bounding-box annotation + description caption
 *   takeaway — amber text card on dark background
 *
 * The tutorial JSON is authored by Claude (via the chatbot) using real
 * timestamps sourced from `./ee query`. Gemini is only used post-render
 * to verify that bounding boxes look visually correct.
 */
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Output, generateText, jsonSchema } from "ai";
import { google } from "@ai-sdk/google";
import { env } from "../env";

const VIDEOS_DIR = resolve(import.meta.dirname, "../../../../data/videos");
const SCRIPTS_DIR = resolve(
  import.meta.dirname,
  "../../../../data/tutorials/scripts",
);
const TUTORIALS_DIR = resolve(
  import.meta.dirname,
  "../../../../data/tutorials/videos",
);
const TMP_DIR = resolve(import.meta.dirname, "../../../../data/tmp");

// ─── Step types ───────────────────────────────────────────────────────────────

interface NarrateStep {
  type: "narrate";
  text: string;
}

interface PlayStep {
  type: "play";
  video: string;
  startSec: number;
  endSec: number;
  label?: string;
}

interface PauseStep {
  type: "pause";
  video: string;
  timestampSec: number;
  description: string;
  region?: { x: number; y: number; w: number; h: number };
}

interface TakeawayStep {
  type: "takeaway";
  text: string;
}

type Step = NarrateStep | PlayStep | PauseStep | TakeawayStep;

interface TutorialScript {
  title: string;
  type: string;
  description: string;
  trade?: string;
  skill?: string;
  generatedAt: string;
  steps: Step[];
}

interface TutorialMeta {
  id: string;
  title: string;
  trade: string;
  skill: string;
  description: string;
  generatedAt: string;
  videoPath: string;
  thumbnailPath: string;
}

// ─── Review schema (Gemini post-render check) ─────────────────────────────────

interface ReviewOutput {
  issues: Array<{
    stepIndex: number;
    issue: string;
  }>;
}

const REVIEW_SCHEMA = jsonSchema<ReviewOutput>({
  type: "object",
  additionalProperties: false,
  properties: {
    issues: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          stepIndex: { type: "number" },
          issue: { type: "string" },
        },
        required: ["stepIndex", "issue"],
      },
    },
  },
  required: ["issues"],
});

// ─── Entry point ──────────────────────────────────────────────────────────────

export default async function tutorialCommand(args: string[]): Promise<void> {
  const subcommand = args[0];

  if (subcommand !== "render") {
    console.error(`
  ee tutorial render <id> [--model <gemini-model>]

  Renders data/tutorials/scripts/<id>.json → data/tutorials/videos/<id>.mp4

  The tutorial JSON is authored by the Claude chatbot using timestamps
  sourced from \`./ee query\`. Run the chatbot and ask it to create a
  tutorial, then render the result with this command.

  Example:
    ./ee tutorial render mortar-buttering-technique
`);
    process.exit(1);
  }

  const id = args[1];
  if (!id) {
    console.error("Usage: ee tutorial render <id>");
    process.exit(1);
  }

  const modelId = getFlag(args, "model") ?? env.EE_GEMINI_MODEL;
  const scriptPath = resolve(SCRIPTS_DIR, `${id}.json`);

  if (!existsSync(scriptPath)) {
    console.error(`Tutorial script not found: ${scriptPath}`);
    console.error(
      `Author a tutorial via the chatbot first, then run this command.`,
    );
    process.exit(1);
  }

  const script: TutorialScript = JSON.parse(await readFile(scriptPath, "utf8"));

  console.log(`Tutorial: ${script.title}`);
  console.log(`Steps:    ${script.steps.length}`);

  // ── Render ────────────────────────────────────────────────────────────────

  const segDir = resolve(TMP_DIR, `tutorial-${id}`);
  await mkdir(segDir, { recursive: true });
  await mkdir(TUTORIALS_DIR, { recursive: true });

  const fontPath = findFont();
  const segPaths: string[] = [];

  for (let i = 0; i < script.steps.length; i++) {
    const step = script.steps[i];
    const segPath = resolve(segDir, `seg_${String(i).padStart(3, "0")}.mp4`);
    console.log(`[${i + 1}/${script.steps.length}] ${step.type}…`);
    await renderStep(step, segPath, segDir, fontPath);
    segPaths.push(segPath);
  }

  const draftPath = resolve(TUTORIALS_DIR, `${id}.draft.mp4`);
  console.log("Concatenating segments…");
  await concatenateSegments(segPaths, segDir, draftPath);

  const thumbPath = resolve(TUTORIALS_DIR, `${id}.thumb.jpg`);
  await extractThumbnail(draftPath, thumbPath);

  // ── Gemini review ─────────────────────────────────────────────────────────

  console.log("Running visual review…");
  await reviewRender(script, draftPath, segDir, modelId);

  // ── Finalize ──────────────────────────────────────────────────────────────

  const finalPath = resolve(TUTORIALS_DIR, `${id}.mp4`);
  await runFfmpeg(["-i", draftPath, "-c", "copy", "-y", finalPath]);

  const meta: TutorialMeta = {
    id,
    title: script.title,
    trade: script.trade ?? "General",
    skill: script.skill ?? script.title,
    description: script.description,
    generatedAt: new Date().toISOString(),
    videoPath: `data/tutorials/videos/${id}.mp4`,
    thumbnailPath: `data/tutorials/videos/${id}.thumb.jpg`,
  };
  await writeJson(resolve(TUTORIALS_DIR, `${id}.meta.json`), meta);

  // Cleanup
  await rm(segDir, { recursive: true, force: true });
  await rm(draftPath, { force: true });

  console.log(`\nDone!`);
  console.log(`  Video:     data/tutorials/videos/${id}.mp4`);
  console.log(`  Thumbnail: data/tutorials/videos/${id}.thumb.jpg`);
}

// ─── Step renderers ───────────────────────────────────────────────────────────

async function renderStep(
  step: Step,
  segPath: string,
  segDir: string,
  fontPath: string | null,
): Promise<void> {
  switch (step.type) {
    case "narrate":
      return renderTextCard(step.text, "#ececec", 6, segPath, fontPath);
    case "takeaway":
      return renderTextCard(step.text, "#f59e0b", 7, segPath, fontPath);
    case "play":
      return renderPlayClip(step, segPath, fontPath);
    case "pause":
      return renderPauseFrame(step, segPath, segDir, fontPath);
    default:
      console.warn(`  Unknown step type, skipping.`);
  }
}

/** Renders a text card: dark background with centered text. */
async function renderTextCard(
  text: string,
  color: string,
  durationSec: number,
  output: string,
  fontPath: string | null,
): Promise<void> {
  const fontFile = fontPath ? `fontfile=${fontPath}:` : "";
  const lines = text.split(/\\n|\n/).filter((l) => l.trim());
  const tmpDir = resolve(output, "..");

  // Write each line to a temp file so drawtext textfile= is used instead of
  // text= — this avoids all ffmpeg filter-option escaping issues with : and ,
  const textFiles: string[] = [];
  const filters: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const filePath = resolve(tmpDir, `_textcard_line_${i}.txt`);
    await writeFile(filePath, lines[i].trim());
    textFiles.push(filePath);
    filters.push(
      `drawtext=${fontFile}fontsize=36:fontcolor=${color}:x=(w-text_w)/2:y=${280 + i * 50}:textfile=${filePath}`,
    );
  }

  const vf = filters.length > 0 ? filters.join(",") : "null";

  try {
    await runFfmpeg([
      "-f",
      "lavfi",
      "-i",
      "color=c=0x1a1a1a:size=1280x720:rate=30",
      "-vf",
      vf,
      "-t",
      String(durationSec),
      "-c:v",
      "libx264",
      "-preset",
      "fast",
      "-crf",
      "23",
      "-an",
      "-y",
      output,
    ]);
  } finally {
    for (const f of textFiles) {
      await rm(f, { force: true });
    }
  }
}

/** Renders a raw video clip, with optional label caption. */
async function renderPlayClip(
  step: PlayStep,
  output: string,
  fontPath: string | null,
): Promise<void> {
  const videoPath = resolve(VIDEOS_DIR, step.video);
  if (!existsSync(videoPath)) {
    console.warn(`  Video not found: ${step.video} — rendering placeholder.`);
    return renderTextCard(
      step.label ?? step.video,
      "#ececec",
      5,
      output,
      fontPath,
    );
  }

  const dur = Math.max(1, Math.min(step.endSec - step.startSec, 120));
  const fontFile = fontPath ? `fontfile=${fontPath}:` : "";

  const filters: string[] = [];
  if (step.label) {
    const escaped = escapeFfmpegText(step.label);
    filters.push(
      `drawtext=${fontFile}fontsize=26:fontcolor=white:box=1:boxcolor=black@0.6:boxborderw=6:x=(w-text_w)/2:y=h-56:text='${escaped}'`,
    );
  }

  const vf = filters.length > 0 ? filters.join(",") : "null";

  await runFfmpeg([
    "-ss",
    String(step.startSec),
    "-i",
    videoPath,
    "-t",
    String(dur),
    "-vf",
    vf,
    "-c:v",
    "libx264",
    "-preset",
    "fast",
    "-crf",
    "23",
    "-an",
    "-y",
    output,
  ]);
}

/**
 * Renders a freeze-frame with an amber bounding-box annotation.
 * Step 1: extract a single JPEG frame with box drawn.
 * Step 2: loop that frame into a ~5-second video with description caption.
 */
async function renderPauseFrame(
  step: PauseStep,
  output: string,
  segDir: string,
  fontPath: string | null,
): Promise<void> {
  const videoPath = resolve(VIDEOS_DIR, step.video);
  if (!existsSync(videoPath)) {
    console.warn(`  Video not found: ${step.video} — rendering placeholder.`);
    return renderTextCard(step.description, "#ececec", 5, output, fontPath);
  }

  const fontFile = fontPath ? `fontfile=${fontPath}:` : "";
  const framePath = resolve(
    segDir,
    `pause_frame_${String(step.timestampSec).replace(".", "_")}.jpg`,
  );

  // Build box filter if region is specified
  const boxFilter = buildBoxFilter(step.region);
  const frameVf = ["scale=1280:720", ...(boxFilter ? [boxFilter] : [])].join(
    ",",
  );

  // Step 1: extract annotated still frame
  await runFfmpeg([
    "-ss",
    String(step.timestampSec),
    "-i",
    videoPath,
    "-frames:v",
    "1",
    "-vf",
    frameVf,
    "-q:v",
    "2",
    "-y",
    framePath,
  ]);

  // Step 2: loop still into 5-second video with description caption
  const captionFilters: string[] = [];
  if (step.description) {
    const escaped = escapeFfmpegText(step.description);
    captionFilters.push(
      `drawtext=${fontFile}fontsize=26:fontcolor=white:box=1:boxcolor=black@0.65:boxborderw=8:x=(w-text_w)/2:y=h-60:text='${escaped}'`,
    );
  }

  const loopVf = captionFilters.length > 0 ? captionFilters.join(",") : "null";

  await runFfmpeg([
    "-loop",
    "1",
    "-framerate",
    "30",
    "-i",
    framePath,
    "-vf",
    loopVf,
    "-t",
    "5",
    "-c:v",
    "libx264",
    "-preset",
    "fast",
    "-crf",
    "23",
    "-an",
    "-y",
    output,
  ]);
}

/**
 * Builds a drawbox filter string for a normalized region {x,y,w,h}.
 * Dimensions are against 1280x720 (after scale filter).
 */
function buildBoxFilter(
  region: { x: number; y: number; w: number; h: number } | undefined,
): string | null {
  if (!region) return null;
  const W = 1280;
  const H = 720;
  const px = Math.round(region.x * W);
  const py = Math.round(region.y * H);
  const pw = Math.round(region.w * W);
  const ph = Math.round(region.h * H);
  return `drawbox=x=${px}:y=${py}:w=${pw}:h=${ph}:color=f59e0b@0.9:t=4`;
}

// ─── Concatenation & finalization ─────────────────────────────────────────────

async function concatenateSegments(
  segPaths: string[],
  segDir: string,
  output: string,
): Promise<void> {
  const fileListContent = segPaths
    .map((p) => `file '${p.replace(/'/g, "'\\''")}'`)
    .join("\n");
  const fileListPath = resolve(segDir, "filelist.txt");
  await writeFile(fileListPath, fileListContent + "\n", "utf8");

  await runFfmpeg([
    "-f",
    "concat",
    "-safe",
    "0",
    "-i",
    fileListPath,
    "-c:v",
    "libx264",
    "-preset",
    "fast",
    "-crf",
    "23",
    "-an",
    "-y",
    output,
  ]);
}

async function extractThumbnail(
  videoPath: string,
  thumbPath: string,
): Promise<void> {
  await runFfmpeg([
    "-i",
    videoPath,
    "-frames:v",
    "1",
    "-q:v",
    "2",
    "-y",
    thumbPath,
  ]);
}

// ─── Gemini review ────────────────────────────────────────────────────────────

async function reviewRender(
  script: TutorialScript,
  draftPath: string,
  segDir: string,
  modelId: string,
): Promise<void> {
  const framesDir = resolve(segDir, "review-frames");
  await mkdir(framesDir, { recursive: true });

  try {
    await runFfmpeg([
      "-i",
      draftPath,
      "-vf",
      "fps=0.5",
      "-frames:v",
      "20",
      "-y",
      resolve(framesDir, "frame_%04d.jpg"),
    ]);
  } catch {
    console.warn("  Frame extraction failed — skipping review.");
    return;
  }

  const frameFiles = (await readdir(framesDir))
    .filter((f) => /^frame_\d+\.jpg$/.test(f))
    .sort()
    .map((f) => resolve(framesDir, f));

  if (frameFiles.length === 0) {
    console.log("  No frames extracted — skipping review.");
    return;
  }

  try {
    const frameContents = await Promise.all(
      frameFiles.map(async (p) => ({
        type: "file" as const,
        data: await readFile(p),
        mediaType: "image/jpeg" as const,
      })),
    );

    const { output } = await generateText({
      model: google(modelId),
      output: Output.object({ schema: REVIEW_SCHEMA }),
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: [
                "Review these frames from a construction training tutorial video.",
                "Check for: bounding boxes that miss the intended subject, text that is unreadable, clips showing wrong activity, or freeze frames that are blurry/black.",
                "Return an empty issues array if quality looks acceptable.",
                "",
                "Tutorial script:",
                JSON.stringify(script, null, 2),
              ].join("\n"),
            },
            ...frameContents,
          ],
        },
      ],
    });

    if (output.issues.length === 0) {
      console.log("  Review passed.");
    } else {
      console.warn(`  Review flagged ${output.issues.length} issue(s):`);
      for (const iss of output.issues) {
        console.warn(`    Step ${iss.stepIndex}: ${iss.issue}`);
      }
      console.warn(
        "  Issues logged above. Edit the tutorial JSON and re-render to fix.",
      );
    }
  } catch (err) {
    console.warn(`  Review call failed: ${toErrorMessage(err)}`);
  }
}

// ─── ffmpeg helpers ───────────────────────────────────────────────────────────

async function runFfmpeg(args: string[]): Promise<void> {
  const proc = Bun.spawn(["ffmpeg", ...args], {
    stdout: "ignore",
    stderr: "inherit",
  });
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    throw new Error(`ffmpeg exited with code ${exitCode}`);
  }
}

function escapeFfmpegText(text: string): string {
  // Text is wrapped in single quotes in the filter string, so only backslashes
  // and single quotes need escaping. Colons and commas are safe inside quotes.
  return text.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

// ─── File helpers ─────────────────────────────────────────────────────────────

function findFont(): string | null {
  const candidates = [
    "/System/Library/Fonts/Supplemental/Arial.ttf",
    "/System/Library/Fonts/Helvetica.ttc",
    "/Library/Fonts/Arial.ttf",
    "/System/Library/Fonts/SFNS.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    "/usr/share/fonts/TTF/DejaVuSans.ttf",
    "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
  ];
  for (const f of candidates) {
    if (existsSync(f)) return f;
  }
  return null;
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function getFlag(args: string[], name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  return i !== -1 && i + 1 < args.length && !args[i + 1].startsWith("--")
    ? args[i + 1]
    : undefined;
}
