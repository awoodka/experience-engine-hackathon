/**
 * video-list command: scans data/ for video files and outputs JSON metadata.
 */
import type { Dirent } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { extname, resolve } from "node:path";
import { VIDEOS_DIR } from "../paths.js";

const VIDEO_EXTENSIONS = new Set([
  ".mp4",
  ".mov",
  ".m4v",
  ".avi",
  ".mkv",
  ".webm",
  ".mpeg",
  ".mpg",
]);

interface VideoEntry {
  name: string;
  path: string;
  sizeBytes: number;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export default async function videoList(_args: string[]): Promise<void> {
  let entries: Dirent[];
  try {
    entries = await readdir(VIDEOS_DIR, { withFileTypes: true });
  } catch {
    console.log(JSON.stringify([]));
    return;
  }

  const results: VideoEntry[] = [];

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (!VIDEO_EXTENSIONS.has(extname(entry.name).toLowerCase())) continue;

    const absolutePath = resolve(VIDEOS_DIR, entry.name);
    const fileStat = await stat(absolutePath);

    results.push({
      name: entry.name,
      path: `data/videos/${entry.name}`,
      sizeBytes: fileStat.size,
    });
  }

  results.sort((a, b) => a.name.localeCompare(b.name));
  console.log(JSON.stringify(results, null, 2));
}
