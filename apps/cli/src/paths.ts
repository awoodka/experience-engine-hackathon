/**
 * Shared path constants for the CLI.
 */
import { resolve } from "node:path";

export const PROJECT_ROOT = resolve(import.meta.dirname, "../../..");
export const VIDEOS_DIR = resolve(PROJECT_ROOT, "data/videos");
export const INDEX_DIR = resolve(PROJECT_ROOT, "data/index");
export const TUTORIALS_DIR = resolve(PROJECT_ROOT, "data/tutorials/videos");
export const TMP_DIR = resolve(PROJECT_ROOT, "data/tmp");
export const FRAMES_DIR = resolve(TMP_DIR, "frames");
export const CLIPS_DIR = resolve(TMP_DIR, "clips");
