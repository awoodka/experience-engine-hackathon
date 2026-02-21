/**
 * Event log: converts Gemini timeline segments into a normalized, time-ordered event log.
 *
 * Why we need this:
 * The timeline JSON has rich but heterogeneous segment data. To compute hesitation,
 * coordination, attention, and smoothness features, we need:
 * - Consistent time ordering
 * - Inferred task types (check, risky, carry, install) for heuristics
 * - Worker labels preserved for coordination
 *
 * Each segment becomes one event. We do not split segments—that would require
 * finer-grained data (e.g. pose) that we don't have yet.
 */

import type {
  BehaviorEvent,
  EventLog,
  TaskType,
  TimelineSegment,
} from "./behavior-types.js";

/**
 * Keywords (lowercase) that indicate a CHECK/INSPECT task.
 * Presence of these before risky tasks suggests attention/perception.
 */
const CHECK_KEYWORDS = [
  "inspect",
  "check",
  "verify",
  "measure",
  "align",
  "examine",
  "assess",
  "confirm",
  "marking",
  "layout",
];

/**
 * Keywords that indicate a RISKY task (cut, drill, lift, etc.).
 * These benefit from a preceding check step.
 */
const RISKY_KEYWORDS = [
  "cut",
  "drill",
  "lift",
  "press",
  "join",
  "install",
  "pressing",
  "joining",
  "fitting",
  "activation",
  "insertion",
];

/**
 * Keywords that indicate CARRY/TRANSPORT (for handoff detection).
 * Worker A "carries" → Worker B "installs" = handoff.
 */
const CARRY_KEYWORDS = [
  "carry",
  "transport",
  "move",
  "retriev",
  "carrying",
  "moving",
  "transporting",
];

/**
 * Keywords that indicate INSTALL/USE (completion of a sequence).
 */
const INSTALL_KEYWORDS = [
  "install",
  "join",
  "press",
  "fit",
  "insert",
  "placing",
  "assembly",
];

/**
 * Infers task type from activity text using keyword matching.
 * We use simple substring matching (lowercase) because Gemini's activity
 * descriptions are free-form. A more robust approach would use an LLM
 * to classify, but for hackathon scope this heuristic is sufficient.
 */
function inferTaskType(activity: string): TaskType {
  const lower = activity.toLowerCase();

  // Order matters: check "risky" before "install" since "install" can be both
  for (const kw of CHECK_KEYWORDS) {
    if (lower.includes(kw)) return "check";
  }
  for (const kw of RISKY_KEYWORDS) {
    if (lower.includes(kw)) return "risky";
  }
  for (const kw of CARRY_KEYWORDS) {
    if (lower.includes(kw)) return "carry";
  }
  for (const kw of INSTALL_KEYWORDS) {
    if (lower.includes(kw)) return "install";
  }

  return "other";
}

/**
 * Converts a single timeline segment into a BehaviorEvent.
 */
function segmentToEvent(seg: TimelineSegment, index: number): BehaviorEvent {
  const durationSec = seg.endSec - seg.startSec;

  return {
    tStart: seg.startSec,
    tEnd: seg.endSec,
    durationSec,
    workers: seg.workers ?? [],
    activity: seg.activity,
    tools: seg.tools ?? [],
    materials: seg.materials ?? [],
    riskLevel: seg.riskLevel ?? "low",
    taskType: inferTaskType(seg.activity),
    segmentIndex: index,
  };
}

/**
 * Builds an event log from timeline segments.
 *
 * @param segments - Array of segments from Gemini timeline
 * @param videoId - Identifier for the video (e.g. timeline file stem)
 * @param videoName - Display name (e.g. filename)
 * @returns EventLog sorted by tStart
 */
export function buildEventLog(
  segments: TimelineSegment[],
  videoId: string,
  videoName: string,
): EventLog {
  const events = segments
    .map((seg, i) => segmentToEvent(seg, i))
    .sort((a, b) => a.tStart - b.tStart);

  const durationSec =
    events.length > 0 ? Math.max(...events.map((e) => e.tEnd)) : 0;

  return {
    videoId,
    videoName,
    durationSec,
    events,
  };
}
