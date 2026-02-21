/**
 * Agentic behavioral analysis pipeline — powered by Claude.
 *
 * For each construction timeline, Claude:
 *   1. Reviews the shared task-type vocabulary (and extends it only when needed)
 *   2. Assigns an ordered task-type sequence to each segment
 *   3. Detects implicit intent sub-sequences (hesitation / coordination /
 *      attention / smoothness) within each segment's task-type sequence
 *   4. Invents and computes numeric features per intent instance
 *   5. Produces a 0–100 skill score and natural-language reasoning
 *
 * Output: data/index/behavioral/entries/<videoName>.json
 * Shared vocab: data/index/behavioral/task-vocab.json
 */

import { generateObject } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { z } from "zod";
import { existsSync } from "node:fs";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";

import { INDEX_DIR } from "../paths.js";

// ─── Paths ────────────────────────────────────────────────────────────────────

export const VOCAB_PATH = join(INDEX_DIR, "behavioral", "task-vocab.json");
const ENTRIES_DIR = join(INDEX_DIR, "behavioral", "entries");

// ─── Source types (timeline JSON shape) ──────────────────────────────────────

export interface TimelineFile {
  source: {
    name: string;
    relativePath: string;
  };
  timeline: {
    videoSummary: string;
    segments: TimelineSegment[];
  };
}

export interface TimelineSegment {
  startSec: number;
  endSec: number;
  activity: string;
  tools: string[];
  materials: string[];
  riskLevel: "low" | "medium" | "high";
  expertiseSignals: string[];
  inefficiencySignals: string[];
  communicationEvents: string[];
  ergonomicNotes: string[];
}

// ─── Output types ─────────────────────────────────────────────────────────────

export type TaskVocab = Record<string, string>;

export type ImplicitIntentCategory =
  | "hesitation"
  | "coordination"
  | "attention"
  | "smoothness";

export interface ImplicitIntentInstance {
  category: ImplicitIntentCategory;
  /** Sub-sequence of task types that triggered this intent (ordered). */
  taskSet: string[];
  /** Exact video timestamps for this sub-sequence. */
  startSec: number;
  endSec: number;
  /** Named numeric features computed by Claude for this instance. */
  features: Record<string, number>;
  /** 0 = very poor / novice, 100 = expert-like execution. */
  score: number;
  /** Natural-language explanation of the behaviour pattern. */
  reasoning: string;
}

export interface SegmentResult {
  segmentIndex: number;
  startSec: number;
  endSec: number;
  activity: string;
  /** Full ordered task-type sequence for this segment. */
  taskTypeSequence: string[];
  /** Detected implicit intent instances. Empty if no clear pattern. */
  implicitIntents: ImplicitIntentInstance[];
}

export interface BehavioralVideoEntry {
  videoId: string;
  videoName: string;
  generatedAt: string;
  segments: SegmentResult[];
}

// ─── Zod schemas for structured Claude output ────────────────────────────────

const ImplicitIntentSchema = z.object({
  category: z.enum(["hesitation", "coordination", "attention", "smoothness"]),
  taskSet: z
    .array(z.string())
    .describe(
      "Ordered sub-sequence of task-type labels from taskTypeSequence that reveal this intent",
    ),
  startSec: z
    .number()
    .describe("Video timestamp (seconds) where this sub-sequence starts"),
  endSec: z
    .number()
    .describe("Video timestamp (seconds) where this sub-sequence ends"),
  features: z
    .record(z.number())
    .describe(
      "Named numeric features you computed (e.g. { toolSwitchCount: 2, pauseDurationSec: 8.5 })",
    ),
  score: z
    .number()
    .min(0)
    .max(100)
    .describe("Skill score: 0=very poor/novice, 100=expert-like"),
  reasoning: z
    .string()
    .describe(
      "Short natural-language explanation of what happened and what it indicates about worker skill",
    ),
});

const AnalysisResponseSchema = z.object({
  newVocabEntries: z
    .record(z.string())
    .describe(
      "New task-type entries to add to the shared vocabulary. " +
        "Only add if no existing entry fits. Format: { typeName: 'one-sentence description' }. " +
        "Leave empty ({}) if all needed types already exist.",
    ),
  segments: z.array(
    z.object({
      segmentIndex: z
        .number()
        .describe("Must match the segmentIndex from the input"),
      taskTypeSequence: z
        .array(z.string())
        .describe(
          "Ordered list of task-type labels describing the action flow within this segment",
        ),
      implicitIntents: z
        .array(ImplicitIntentSchema)
        .describe(
          "Implicit intent instances detected. Leave empty [] if no genuine signal — do NOT force-fit.",
        ),
    }),
  ),
});

// ─── Vocabulary helpers ───────────────────────────────────────────────────────

const SEED_VOCAB: TaskVocab = {
  check: "Inspect, verify, measure, or align something before acting",
  carry: "Transport, move, retrieve, or hand off materials or tools",
  install:
    "Join, press, fit, insert, or permanently fix something into position",
  risky:
    "Perform a high-risk precision action: cut, drill, lift, press, strike",
  idle: "Pause, wait, or stand without active task engagement",
  communicate: "Verbal or gestural communication between workers",
  organize: "Sort, store, clean up, or arrange materials and tools",
  navigate: "Walk, reposition, or move through the work site",
};

async function loadVocab(): Promise<TaskVocab> {
  if (!existsSync(VOCAB_PATH)) return { ...SEED_VOCAB };
  try {
    const raw = await readFile(VOCAB_PATH, "utf-8");
    return JSON.parse(raw) as TaskVocab;
  } catch {
    return { ...SEED_VOCAB };
  }
}

async function saveVocab(vocab: TaskVocab): Promise<void> {
  await mkdir(dirname(VOCAB_PATH), { recursive: true });
  const sorted = Object.fromEntries(Object.entries(vocab).sort());
  await writeFile(VOCAB_PATH, JSON.stringify(sorted, null, 2), "utf-8");
}

// ─── Main pipeline ────────────────────────────────────────────────────────────

export async function runBehavioralPipeline(
  timelinePath: string,
  videoId: string,
  modelId: string,
): Promise<BehavioralVideoEntry> {
  const raw = await readFile(timelinePath, "utf-8");
  const timelineFile = JSON.parse(raw) as TimelineFile;
  const videoName = timelineFile.source.name;
  const { videoSummary, segments } = timelineFile.timeline;

  const vocab = await loadVocab();

  const vocabLines = Object.entries(vocab)
    .map(([k, v]) => `  "${k}": ${v}`)
    .join("\n");

  const segmentData = segments.map((seg, i) => ({
    segmentIndex: i,
    startSec: seg.startSec,
    endSec: seg.endSec,
    durationSec: seg.endSec - seg.startSec,
    activity: seg.activity,
    tools: seg.tools,
    materials: seg.materials,
    riskLevel: seg.riskLevel,
    expertiseSignals: seg.expertiseSignals,
    inefficiencySignals: seg.inefficiencySignals,
    communicationEvents: seg.communicationEvents,
    ergonomicNotes: seg.ergonomicNotes,
  }));

  const prompt = `\
You are analyzing a construction site video to assess worker behaviour and skill.

VIDEO SUMMARY:
${videoSummary}

SHARED TASK-TYPE VOCABULARY (${Object.keys(vocab).length} entries):
${vocabLines}

SEGMENTS (${segments.length} total — each has a segmentIndex, startSec, endSec, and rich metadata):
${JSON.stringify(segmentData, null, 2)}

───────────────────────────────────────────────────────────────
YOUR TASK: for EACH segment produce three outputs:

1. TASK TYPE SEQUENCE
   Break the segment into an ordered list of task-type labels that describe
   the action flow within that segment. Use vocabulary entries above where possible.
   Only coin new types if nothing fits — new types must be genuinely distinct.
   Return new entries in "newVocabEntries".

2. IMPLICIT INTENT DETECTION
   Scan the task-type sequence for sub-sequences that naturally reveal ONE of:

   • HESITATION   — uncertainty / rework patterns
     e.g. carry→check→carry (fetched tool, wasn't sure, re-fetched)
     e.g. install→check→install (started task, stopped, restarted)

   • COORDINATION — hand-off, synchronisation, or partner-wait patterns
     e.g. carry→idle→install across workers
     e.g. communicate→carry→install (instruction before hand-off)

   • ATTENTION    — deliberate check-before-act verification patterns
     e.g. check→risky, check→install (precautionary inspection)
     e.g. repeated check before the same risky action

   • SMOOTHNESS   — timing-driven disruption patterns
     e.g. very short task durations (<5 s) suggesting micro-stops
     e.g. high duration variance within the segment suggesting erratic pacing

   Leave implicitIntents = [] if no genuine signal is present.
   DO NOT force-fit — a segment can have zero intent instances.

3. FEATURES, SCORE & REASONING
   For each detected intent instance:
   a. Invent and compute appropriate NUMERIC FEATURES (name them clearly).
      Examples by category:
        hesitation:    toolSwitchCount, reworkCount, pauseBeforeResumeSec, backtrackCount
        coordination:  handoffGapSec, waitTimeSec, syncEventCount, communicationCount
        attention:     checkToActRatioSec, verificationCount, checkBeforeRiskyRate
        smoothness:    microStopCount, shortSegmentCount, durationVarianceSec, paceChanges
   b. Score 0–100 (100 = expert, fluent execution; 0 = very poor).
   c. Write reasoning: one or two sentences describing what happened and what it
      implies about the worker's skill level.

TIMESTAMP RULES:
   - Sub-sequence startSec/endSec must be within the parent segment's range.
   - Estimate proportionally from the segment duration if exact timing is unknown.

VOCAB RULES:
   - Check the vocab list before adding new types.
   - Only add new types if the activity is genuinely not covered.
`;

  const { object } = await generateObject({
    model: anthropic(modelId),
    schema: AnalysisResponseSchema,
    prompt,
  });

  // Persist any new vocab entries
  if (Object.keys(object.newVocabEntries).length > 0) {
    Object.assign(vocab, object.newVocabEntries);
    await saveVocab(vocab);
  }

  // Build output segments
  const resultSegments: SegmentResult[] = object.segments.map((s) => {
    const src = segments[s.segmentIndex]!;
    return {
      segmentIndex: s.segmentIndex,
      startSec: src.startSec,
      endSec: src.endSec,
      activity: src.activity,
      taskTypeSequence: s.taskTypeSequence,
      implicitIntents: s.implicitIntents,
    };
  });

  const entry: BehavioralVideoEntry = {
    videoId,
    videoName,
    generatedAt: new Date().toISOString(),
    segments: resultSegments,
  };

  // Write output entry
  await mkdir(ENTRIES_DIR, { recursive: true });
  const outName = videoName.replace(/\.[^.]+$/, "") + ".json";
  const outPath = join(ENTRIES_DIR, outName);
  await writeFile(outPath, JSON.stringify(entry, null, 2), "utf-8");

  return entry;
}
