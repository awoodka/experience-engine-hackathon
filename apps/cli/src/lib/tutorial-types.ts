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
  durationSec?: number;
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

export type Step = NarrateStep | PlayStep | PauseStep | TakeawayStep;

export interface TutorialScript {
  title: string;
  type: string;
  description: string;
  trade?: string;
  skill?: string;
  generatedAt: string;
  steps: Step[];
}

export interface TutorialMeta {
  id: string;
  title: string;
  trade: string;
  skill: string;
  description: string;
  generatedAt: string;
  videoPath: string;
  thumbnailPath: string;
  configHash?: string;
}
