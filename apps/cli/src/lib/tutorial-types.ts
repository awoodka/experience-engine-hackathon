/**
 * Shared tutorial step and script types.
 * Single source of truth — used by renderers and validators.
 */

export interface Region {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface NarrateStep {
  type: "narrate";
  text: string;
  durationSec?: number;
}

export interface PlayStep {
  type: "play";
  video: string;
  startSec: number;
  endSec: number;
  label?: string;
  description?: string; // What this clip is intended to show — not rendered, used for LM review
  durationSec?: number;
  slowMo?: number; // Playback speed multiplier (0.5 = half speed). Output duration = clip / slowMo.
}

export interface PauseStep {
  type: "pause";
  video: string;
  timestampSec: number;
  description: string;
  region?: Region;
  frame?: string;
  refs?: Array<{ [key: string]: unknown }>;
  durationSec?: number;
}

export interface TakeawayStep {
  type: "takeaway";
  text: string;
  durationSec?: number;
}

export interface RootCauseStep {
  type: "root-cause";
  text: string;
  durationSec?: number;
}

export interface ImpactStep {
  type: "impact";
  text: string;
  durationSec?: number;
}

export type Step =
  | NarrateStep
  | PlayStep
  | PauseStep
  | TakeawayStep
  | RootCauseStep
  | ImpactStep;

export interface TutorialScript {
  title: string;
  description: string;
  generatedAt: string;
  steps: Step[];
}

export interface TutorialMeta {
  id: string;
  title: string;
  description: string;
  generatedAt: string;
  videoPath: string;
  thumbnailPath: string;
  configHash?: string;
}
