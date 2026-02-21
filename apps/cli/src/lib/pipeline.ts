/**
 * Pipeline: runs the full preprocessing flow for a single timeline.
 *
 * Flow: Timeline (Gemini JSON) → EventLog → RawFeatures → HeuristicScores
 *
 * This module ties together event-log, features, and scores. It is the
 * single entry point for "score this timeline" logic.
 */

import { buildEventLog } from "./event-log.js";
import { extractFeatures } from "./features.js";
import { computeScores } from "./scores.js";
import type {
  HeuristicScores,
  RawFeatures,
  TimelineSegment,
} from "./behavior-types.js";

/** Result of running the pipeline on one timeline. */
export interface PipelineResult {
  videoId: string;
  videoName: string;
  eventCount: number;
  features: RawFeatures;
  scores: HeuristicScores;
}

/**
 * Runs the full behavioral preprocessing pipeline.
 *
 * @param segments - Timeline segments from Gemini (timeline.timeline.segments)
 * @param videoId - Identifier (e.g. timeline file stem)
 * @param videoName - Display name (e.g. source filename)
 * @returns PipelineResult with features and scores
 */
export function runPipeline(
  segments: TimelineSegment[],
  videoId: string,
  videoName: string,
): PipelineResult {
  const log = buildEventLog(segments, videoId, videoName);
  const features = extractFeatures(log);
  const scores = computeScores(features);

  return {
    videoId,
    videoName,
    eventCount: log.events.length,
    features,
    scores,
  };
}
