/**
 * Feature extraction: computes raw numeric features from an event log.
 *
 * These features feed into the heuristic score formulas. We extract:
 * - Hesitation: idle gaps, tool switching, rework
 * - Coordination: handoff latency, wait-on-other proxy
 * - Attention: check-before-act rate, missed checks
 * - Smoothness: segment duration variance, micro-stops (event-log proxy)
 *
 * All logic uses only the event log—no pose, tracking, or video pixels.
 */

import type { BehaviorEvent, EventLog, RawFeatures } from "./behavior-types.js";

/** Maximum gap (seconds) to consider "idle" for hesitation. Gaps larger than this are capped. */
const MAX_GAP_SEC = 120;

/** Time window (seconds) for check-before-act: check must occur within this before risky task. */
const CHECK_WINDOW_SEC = 10;

/** Time window (seconds) for rework: start→stop→restart within this = rework. */
const REWORK_WINDOW_SEC = 30;

/** Segment duration (seconds) below which we count a "micro-stop" (choppy motion proxy). */
const MICRO_STOP_THRESHOLD_SEC = 5;

/** Minimum handoff gap (seconds) to consider A→B a handoff. Filters noise. */
const HANDOFF_MIN_GAP_SEC = 2;

/** Maximum handoff gap (seconds) to consider A→B a handoff. Beyond this = not coordinated. */
const HANDOFF_MAX_GAP_SEC = 60;

/**
 * Computes median of an array of numbers.
 * Returns 0 for empty array. Used for gap duration (robust to outliers).
 */
function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1]! + sorted[mid]!) / 2
    : sorted[mid]!;
}

/**
 * Computes coefficient of variation (std / mean).
 * Returns 0 if mean is 0. Used for smoothness (high CV = choppy).
 */
function coefficientOfVariation(values: number[]): number {
  if (values.length === 0) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  if (mean === 0) return 0;
  const variance =
    values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance) / mean;
}

/**
 * Extracts idle gaps between consecutive events.
 * gap_i = start_{i+1} - end_i. Gaps are capped at MAX_GAP_SEC to avoid
 * outlier effects (e.g. long scene cuts).
 */
function extractGaps(events: BehaviorEvent[]): number[] {
  const gaps: number[] = [];
  for (let i = 0; i < events.length - 1; i++) {
    const curr = events[i]!;
    const next = events[i + 1]!;
    const gap = Math.min(next.tStart - curr.tEnd, MAX_GAP_SEC);
    if (gap > 0) gaps.push(gap);
  }
  return gaps;
}

/**
 * Counts tool switches: consecutive segments with different tool sets.
 * We compare tool arrays by sorted string join (order-independent).
 */
function countToolSwitches(events: BehaviorEvent[]): number {
  let switches = 0;
  for (let i = 0; i < events.length - 1; i++) {
    const curr = events[i]!.tools;
    const next = events[i + 1]!.tools;
    const currKey = [...curr].sort().join(",");
    const nextKey = [...next].sort().join(",");
    if (currKey !== nextKey && (curr.length > 0 || next.length > 0)) {
      switches++;
    }
  }
  return switches;
}

/**
 * Detects rework sequences: same activity type (by taskType) appears,
 * then a different task, then the same again within REWORK_WINDOW_SEC.
 * "Start task → stop → restart same task" = hesitation indicator.
 */
function countRework(events: BehaviorEvent[]): number {
  let rework = 0;
  for (let i = 0; i < events.length - 2; i++) {
    const a = events[i]!;
    const c = events[i + 2]!;
    if (a.taskType === c.taskType && a.taskType !== "other") {
      const window = c.tEnd - a.tStart;
      if (window <= REWORK_WINDOW_SEC) rework++;
    }
  }
  return rework;
}

/**
 * Detects handoffs: carry event ends → install event starts.
 * The gap between them is handoff latency. We require gap within
 * [HANDOFF_MIN_GAP_SEC, HANDOFF_MAX_GAP_SEC] to filter noise and
 * exclude unrelated sequences. Multi-worker segments are preferred
 * but we count any carry→install for robustness.
 */
function extractHandoffLatencies(events: BehaviorEvent[]): number[] {
  const latencies: number[] = [];
  for (let i = 0; i < events.length - 1; i++) {
    const carry = events[i]!;
    const install = events[i + 1]!;
    if (carry.taskType !== "carry" || install.taskType !== "install") continue;

    const gap = install.tStart - carry.tEnd;
    if (gap < HANDOFF_MIN_GAP_SEC || gap > HANDOFF_MAX_GAP_SEC) continue;

    latencies.push(gap);
  }
  return latencies;
}

/**
 * Proxy for wait-on-other: in multi-worker segments, sum idle gaps that
 * occur while another worker is active. Simplified: we sum gaps that fall
 * within segments with 2+ workers. This is a heuristic—without zones we
 * can't know who was "waiting" for whom.
 */
function extractWaitTime(events: BehaviorEvent[]): number {
  let wait = 0;
  const multiWorkerTimes = new Set<number>();
  for (const e of events) {
    if (e.workers.length >= 2) {
      for (let t = Math.floor(e.tStart); t < Math.ceil(e.tEnd); t++) {
        multiWorkerTimes.add(t);
      }
    }
  }
  for (let i = 0; i < events.length - 1; i++) {
    const curr = events[i]!;
    const next = events[i + 1]!;
    const gap = next.tStart - curr.tEnd;
    if (gap <= 0) continue;
    const mid = (curr.tEnd + next.tStart) / 2;
    if (multiWorkerTimes.has(Math.floor(mid))) {
      wait += Math.min(gap, MAX_GAP_SEC);
    }
  }
  return wait;
}

/**
 * Check-before-act rate: P(risky task has a check within CHECK_WINDOW_SEC before it).
 * missedCheckCount = risky tasks without preceding check.
 */
function extractCheckBeforeAct(events: BehaviorEvent[]): {
  rate: number;
  missedCount: number;
} {
  const riskyIndices = events
    .map((e, i) => (e.taskType === "risky" ? i : -1))
    .filter((i) => i >= 0);

  let withCheck = 0;
  let missed = 0;

  for (const idx of riskyIndices) {
    const risky = events[idx]!;
    const windowStart = risky.tStart - CHECK_WINDOW_SEC;
    const hasCheck = events.some(
      (e, i) =>
        i < idx &&
        e.taskType === "check" &&
        e.tEnd >= windowStart &&
        e.tEnd <= risky.tStart,
    );
    if (hasCheck) withCheck++;
    else missed++;
  }

  const rate = riskyIndices.length === 0 ? 1 : withCheck / riskyIndices.length;
  return { rate, missedCount: missed };
}

/**
 * Verification diversity: number of distinct check-type activity descriptions.
 */
function extractVerificationDiversity(events: BehaviorEvent[]): number {
  const checkActivities = events
    .filter((e) => e.taskType === "check")
    .map((e) => e.activity.toLowerCase());
  return new Set(checkActivities).size;
}

/**
 * Extracts all raw features from an event log.
 */
export function extractFeatures(log: EventLog): RawFeatures {
  const { events, videoId, videoName, durationSec } = log;

  const gaps = extractGaps(events);
  const medianGapSec = median(gaps);

  const toolSwitches = countToolSwitches(events);
  const durationMin = Math.max(durationSec / 60, 0.01);
  const toolSwitchesPerMin = toolSwitches / durationMin;

  const reworkCount = countRework(events);

  const handoffLatencies = extractHandoffLatencies(events);
  const handoffLatencySec =
    handoffLatencies.length === 0
      ? 0
      : handoffLatencies.reduce((a, b) => a + b, 0) / handoffLatencies.length;

  const handoffCount = handoffLatencies.length;
  const waitTimeSec = extractWaitTime(events);

  const { rate: checkBeforeActRate, missedCount: missedCheckCount } =
    extractCheckBeforeAct(events);
  const verificationDiversity = extractVerificationDiversity(events);

  const durations = events.map((e) => e.durationSec);
  const segmentDurationCv = coefficientOfVariation(durations);
  const microStopCount = events.filter(
    (e) => e.durationSec < MICRO_STOP_THRESHOLD_SEC && e.durationSec > 0,
  ).length;

  return {
    videoId,
    videoName,
    durationSec,
    medianGapSec,
    toolSwitchesPerMin,
    reworkCount,
    handoffLatencySec,
    handoffCount,
    waitTimeSec,
    checkBeforeActRate,
    missedCheckCount,
    verificationDiversity,
    segmentDurationCv,
    microStopCount,
  };
}
