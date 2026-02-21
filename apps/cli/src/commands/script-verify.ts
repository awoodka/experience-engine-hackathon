/**
 * script-verify command: extracts key frames from a rendered tutorial MP4
 * so the agent can visually review them.
 *
 * Usage: ee script-verify <slug>
 *
 * Reads the script JSON to calculate step boundaries, then extracts one
 * frame per step from the rendered MP4. Outputs frame paths as JSON so
 * the agent can read and review each one.
 */
import { readFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { PROJECT_ROOT, TUTORIALS_DIR, TMP_DIR } from "../paths.js";

interface Step {
  type: string;
  text?: string;
  video?: string;
  startSec?: number;
  endSec?: number;
  description?: string;
  timestampSec?: number;
  label?: string;
}

interface Script {
  title: string;
  steps: Step[];
}

export default async function scriptVerify(args: string[]): Promise<void> {
  const slug = args[0];
  if (!slug) {
    console.error("Usage: ee script-verify <slug>");
    process.exit(1);
  }

  const scriptPath = resolve(TUTORIALS_DIR, `${slug}.json`);
  if (!existsSync(scriptPath)) {
    console.error(`Script not found: ${slug}.json`);
    process.exit(1);
  }

  const videoPath = resolve(TMP_DIR, `${slug}.mp4`);
  if (!existsSync(videoPath)) {
    console.error(`Rendered video not found: data/tmp/${slug}.mp4`);
    console.error("Run: ee script-render " + slug);
    process.exit(1);
  }

  const script: Script = JSON.parse(await readFile(scriptPath, "utf8"));

  // Calculate the timestamp midpoint of each step in the rendered video
  const frameTimes: {
    step: number;
    type: string;
    sec: number;
    info: string;
  }[] = [];
  let currentSec = 0;

  for (let i = 0; i < script.steps.length; i++) {
    const step = script.steps[i];
    let duration = 0;

    switch (step.type) {
      case "narrate":
      case "takeaway":
        duration = Math.min(
          5,
          Math.max(2, Math.ceil((step.text?.length ?? 30) / 20)),
        );
        break;
      case "play":
        duration = (step.endSec ?? 0) - (step.startSec ?? 0);
        break;
      case "pause":
        duration = Math.min(
          6,
          Math.max(3, Math.ceil((step.description?.length ?? 60) / 25)),
        );
        break;
    }

    const midpoint = currentSec + duration / 2;
    let info = `[${step.type}]`;
    if (step.type === "play") info += ` ${step.label ?? step.video}`;
    if (step.type === "pause") info += ` "${step.description}"`;
    if (step.type === "narrate" || step.type === "takeaway")
      info += ` "${step.text}"`;

    frameTimes.push({ step: i + 1, type: step.type, sec: midpoint, info });
    currentSec += duration;
  }

  // Extract frames
  const outDir = resolve(TMP_DIR, `_verify_${slug}`);
  await mkdir(outDir, { recursive: true });

  const frames: { step: number; type: string; path: string; info: string }[] =
    [];

  for (const ft of frameTimes) {
    const framePath = resolve(
      outDir,
      `step_${String(ft.step).padStart(2, "0")}_${ft.type}.jpg`,
    );
    const proc = Bun.spawn(
      [
        "ffmpeg",
        "-y",
        "-ss",
        String(ft.sec),
        "-i",
        videoPath,
        "-frames:v",
        "1",
        "-q:v",
        "2",
        framePath,
      ],
      { stdout: "pipe", stderr: "pipe" },
    );
    await proc.exited;

    const relativePath = framePath.replace(PROJECT_ROOT + "/", "");
    frames.push({
      step: ft.step,
      type: ft.type,
      path: relativePath,
      info: ft.info,
    });
  }

  console.log(JSON.stringify({ frames, totalDuration: currentSec }, null, 2));
}
