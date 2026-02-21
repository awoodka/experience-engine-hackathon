/**
 * Shared types for the behavioral preprocessing pipeline.
 *
 * Pipeline: Timeline (Gemini JSON) → EventLog → RawFeatures → HeuristicScores
 *
 * These types define the data structures at each stage. They are kept in a
 * separate file so event-log, features, and scores modules can import them
 * without circular dependencies.
 */

/** A segment from the Gemini-generated timeline (input schema). */
export interface TimelineSegment {
  startSec: number;
  endSec: number;
  activity: string;
  workers: string[];
  tools: string[];
  materials: string[];
  spatialContext: string;
  safetyNotes: string[];
  riskLevel: "low" | "medium" | "high";
  expertiseSignals: string[];
  inefficiencySignals: string[];
  communicationEvents: string[];
  ergonomicNotes: string[];
}

/**
 * Inferred task type for an event.
 * Used for attention/perception (check-before-act) and coordination (handoff) logic.
 * We infer these from activity text via keyword matching—no pose/vision required.
 */
export type TaskType =
  | "check" // inspect, measure, verify, align
  | "risky" // cut, drill, lift, press, join, install (higher risk)
  | "carry" // transport, move, retrieve
  | "install" // install, join, press, fit (completion of a sequence)
  | "other"; // uncategorized

/**
 * Normalized event: one timeline segment turned into a queryable event.
 * Each segment becomes one event. Workers are preserved for coordination analysis.
 */
export interface BehaviorEvent {
  /** Start time in seconds from video start. */
  tStart: number;
  /** End time in seconds from video start. */
  tEnd: number;
  /** Duration in seconds. */
  durationSec: number;
  /** Worker labels from Gemini (e.g. "Technician", "Partner"). Identity is best-effort. */
  workers: string[];
  /** Raw activity description. */
  activity: string;
  /** Tools used in this segment. */
  tools: string[];
  /** Materials involved. */
  materials: string[];
  /** Risk level from Gemini. */
  riskLevel: "low" | "medium" | "high";
  /** Inferred task type for heuristics. */
  taskType: TaskType;
  /** Index in original segments array (for provenance). */
  segmentIndex: number;
}

/**
 * Event log: time-ordered list of events for a single video.
 * Sorted by tStart. Used as input to feature extraction.
 */
export interface EventLog {
  /** Video identifier (e.g. timeline filename without extension). */
  videoId: string;
  /** Video display name. */
  videoName: string;
  /** Total duration of the video in seconds (max tEnd of events). */
  durationSec: number;
  /** Ordered events. */
  events: BehaviorEvent[];
}

/**
 * Raw numeric features extracted from the event log.
 * These are the inputs to the heuristic score formulas.
 * All values are in seconds or counts unless otherwise noted.
 */
export interface RawFeatures {
  videoId: string;
  videoName: string;
  durationSec: number;

  /** Hesitation metrics */
  /** Median idle gap between consecutive events (seconds). */
  medianGapSec: number;
  /** Tool switches per minute (switches / (durationMin)). */
  toolSwitchesPerMin: number;
  /** Count of rework sequences: start→stop→restart same task within window. */
  reworkCount: number;

  /** Coordination metrics */
  /** Mean handoff latency: time from Worker A "carry" end to Worker B "install" start. */
  handoffLatencySec: number;
  /** Count of handoffs detected. */
  handoffCount: number;
  /** Proxy for wait-on-other: idle gaps during multi-worker segments (seconds). */
  waitTimeSec: number;

  /** Attention metrics */
  /** P(check occurs within CHECK_WINDOW_SEC before risky task). 0-1. */
  checkBeforeActRate: number;
  /** Count of risky tasks without preceding check. */
  missedCheckCount: number;
  /** Number of distinct check-type activities. */
  verificationDiversity: number;

  /** Smoothness metrics (event-log proxy; no pose data) */
  /** Coefficient of variation of segment durations (proxy for jerkiness). */
  segmentDurationCv: number;
  /** Count of very short segments (< MICRO_STOP_THRESHOLD_SEC) suggesting choppy motion. */
  microStopCount: number;
}

/**
 * Heuristic scores (0–100). Higher = more expert-like.
 * Computed from RawFeatures using configurable baselines and weights.
 */
export interface HeuristicScores {
  videoId: string;
  videoName: string;
  /** 0–100. Higher = fewer hesitation indicators. */
  hesitationScore: number;
  /** 0–100. Higher = better coordination. */
  coordinationScore: number;
  /** 0–100. Higher = more check-before-act behavior. */
  attentionScore: number;
  /** 0–100. Higher = smoother execution (fewer micro-stops, less variance). */
  smoothnessScore: number;
  /** Unweighted average of the four scores. */
  overallScore: number;
}

/**
 * Expert baseline values for normalization.
 * When comparing novice to expert, we use these as G*, S*, etc.
 * Can be computed from a labeled "expert" index or set manually.
 */
export interface ExpertBaseline {
  medianGapSec: number;
  toolSwitchesPerMin: number;
  handoffLatencySec: number;
  waitTimeSec: number;
  checkBeforeActRate: number;
  segmentDurationCv: number;
  microStopCount: number;
}
