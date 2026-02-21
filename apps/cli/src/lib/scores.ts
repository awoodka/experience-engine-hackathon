/**
 * Heuristic scores: converts raw features into 0–100 scores.
 *
 * Formula rationale:
 * - Higher score = more expert-like behavior.
 * - We normalize against expert baselines (G*, S*, etc.). When baselines
 *   are unavailable, we use built-in defaults calibrated for construction
 *   workflow (small gaps, few tool switches, quick handoffs, high check rate).
 */

import type {
  ExpertBaseline,
  HeuristicScores,
  RawFeatures,
} from "./behavior-types.js";

/**
 * Default expert baseline when no labeled expert data exists.
 * Values are heuristic targets—real calibration should come from
 * processing a labeled "expert" index and computing medians.
 */
const DEFAULT_BASELINE: ExpertBaseline = {
  medianGapSec: 5,
  toolSwitchesPerMin: 2,
  handoffLatencySec: 8,
  waitTimeSec: 30,
  checkBeforeActRate: 0.85,
  segmentDurationCv: 0.5,
  microStopCount: 3,
};

/**
 * Weights for hesitation score: w1 for gaps, w2 for tool switches.
 * Sum should be ~1 so that when G=G* and S=S*, the combined term ≈ 1.
 */
const HESITATION_WEIGHT_GAP = 0.6;
const HESITATION_WEIGHT_SWITCH = 0.4;

/**
 * Penalty per missed check in attention score.
 * attention_score = 100 * rate - penalty * missed_checks
 */
const ATTENTION_MISSED_CHECK_PENALTY = 10;

/**
 * Clamps a number to [min, max].
 */
function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Normalizes a value for coordination: we want score = 100 when normalized=0,
 * and score approaches 0 as normalized grows. We use a simple linear scale
 * with a cap: score = 100 - clamp(normalized * scale, 0, 100).
 */
function normalizeForScore(
  value: number,
  baseline: number,
  scale: number = 10,
): number {
  const ratio = baseline > 0 ? value / baseline : 0;
  return clamp(100 - ratio * scale, 0, 100);
}

/**
 * Computes hesitation score.
 *
 * Formula: hesitation_score = 100 - clamp( w1*(G/G*) + w2*(S/S*), 0, 100 )
 *
 * G = median gap, S = tool switches/min. Experts have smaller G and S.
 * We avoid division by zero by using max(baseline, 0.1).
 */
function computeHesitationScore(
  features: RawFeatures,
  baseline: ExpertBaseline,
): number {
  const G = features.medianGapSec;
  const S = features.toolSwitchesPerMin;
  const Gstar = Math.max(baseline.medianGapSec, 0.1);
  const Sstar = Math.max(baseline.toolSwitchesPerMin, 0.1);

  const term =
    HESITATION_WEIGHT_GAP * (G / Gstar) +
    HESITATION_WEIGHT_SWITCH * (S / Sstar);
  return clamp(100 - term * 50, 0, 100);
}

/**
 * Computes coordination score.
 *
 * Formula: coord_score = 100 - normalized(wait_time + handoff_latency)
 *
 * We sum wait time and mean handoff latency (when handoffs exist), then
 * normalize against baseline. Higher wait + latency = worse coordination.
 */
function computeCoordinationScore(
  features: RawFeatures,
  baseline: ExpertBaseline,
): number {
  const combined =
    features.waitTimeSec +
    (features.handoffCount > 0 ? features.handoffLatencySec * 2 : 0);
  const baselineCombined =
    baseline.waitTimeSec + baseline.handoffLatencySec * 2;
  return normalizeForScore(combined, Math.max(baselineCombined, 1), 2);
}

/**
 * Computes attention score.
 *
 * Formula: attention_score = 100 * check_before_act_rate - penalty * missed_checks
 *
 * Experts check before risky actions. Missed checks are penalized.
 */
function computeAttentionScore(
  features: RawFeatures,
  // baseline reserved for future penalty calibration
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _baseline: ExpertBaseline,
): number {
  const term =
    100 * features.checkBeforeActRate -
    ATTENTION_MISSED_CHECK_PENALTY * features.missedCheckCount;
  return clamp(term, 0, 100);
}

/**
 * Computes smoothness score (event-log proxy).
 *
 * Formula: smoothness_score = 100 - normalized(segmentDurationCv + micro_stops)
 *
 * We use segment duration CV and micro-stop count as proxies for jerkiness.
 * Future: with pose/tracking, use speed variance and actual micro-stops.
 */
function computeSmoothnessScore(
  features: RawFeatures,
  baseline: ExpertBaseline,
): number {
  const combined = features.segmentDurationCv * 20 + features.microStopCount;
  const baselineCombined =
    baseline.segmentDurationCv * 20 + baseline.microStopCount;
  return normalizeForScore(combined, Math.max(baselineCombined, 1), 5);
}

/**
 * Computes all heuristic scores from raw features.
 *
 * @param features - Raw features from extractFeatures()
 * @param baseline - Expert baseline for normalization. If omitted, uses DEFAULT_BASELINE.
 */
export function computeScores(
  features: RawFeatures,
  baseline?: Partial<ExpertBaseline>,
): HeuristicScores {
  const base = { ...DEFAULT_BASELINE, ...baseline };

  const hesitationScore = computeHesitationScore(features, base);
  const coordinationScore = computeCoordinationScore(features, base);
  const attentionScore = computeAttentionScore(features, base);
  const smoothnessScore = computeSmoothnessScore(features, base);

  const overallScore =
    (hesitationScore + coordinationScore + attentionScore + smoothnessScore) /
    4;

  return {
    videoId: features.videoId,
    videoName: features.videoName,
    hesitationScore: Math.round(hesitationScore * 10) / 10,
    coordinationScore: Math.round(coordinationScore * 10) / 10,
    attentionScore: Math.round(attentionScore * 10) / 10,
    smoothnessScore: Math.round(smoothnessScore * 10) / 10,
    overallScore: Math.round(overallScore * 10) / 10,
  };
}
