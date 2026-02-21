/**
 * present command: emits a media result so the frontend renders it inline.
 *
 * Usage: ee present <path>
 *
 * Detects media type from the file extension and outputs the JSON format
 * that the media-transform stream recognises (type "image" or "video").
 */
import { existsSync } from "node:fs";
import { resolve, extname } from "node:path";
import { getPositionals } from "../args.js";
import { PROJECT_ROOT } from "../paths.js";

const IMAGE_EXTS = new Set([".jpg", ".jpeg", ".png", ".webp"]);
const VIDEO_EXTS = new Set([".mp4", ".mov", ".webm"]);

export default async function present(args: string[]): Promise<void> {
  const positionals = getPositionals(args);
  const filePath = positionals[0];

  if (!filePath) {
    console.error("Usage: ee present <path>");
    process.exit(1);
  }

  const absolutePath = resolve(PROJECT_ROOT, filePath);
  if (!existsSync(absolutePath)) {
    console.error(`File not found: ${filePath}`);
    process.exit(1);
  }

  const ext = extname(filePath).toLowerCase();
  let type: "image" | "video";

  if (IMAGE_EXTS.has(ext)) {
    type = "image";
  } else if (VIDEO_EXTS.has(ext)) {
    type = "video";
  } else {
    console.error(
      `Unsupported file type: ${ext}. Expected an image (${[...IMAGE_EXTS].join(", ")}) or video (${[...VIDEO_EXTS].join(", ")}).`,
    );
    process.exit(1);
  }

  console.log(JSON.stringify({ type, path: filePath }));
}
