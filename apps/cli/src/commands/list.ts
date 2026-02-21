import { readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";

const INDICES_DIR = resolve(
  import.meta.dirname,
  "../../../../data/.ee/indices",
);

const manifestSchema = z.object({
  videos: z
    .array(
      z.object({
        status: z.enum(["pending", "processing", "done", "error"]),
      }),
    )
    .catch([]),
});

export default async function list(_args: string[]): Promise<void> {
  try {
    const entries = await readdir(INDICES_DIR, { withFileTypes: true });
    const dirs = entries.filter((e) => e.isDirectory());

    if (dirs.length === 0) {
      console.log("No indices found. Run `ee process` to create one.");
      return;
    }

    console.log("Indices:\n");
    for (const dir of dirs) {
      const manifestPath = resolve(INDICES_DIR, dir.name, "manifest.json");
      try {
        const manifestRaw: unknown = await Bun.file(manifestPath).json();
        const parsedManifest = manifestSchema.safeParse(manifestRaw);
        const videos = parsedManifest.success ? parsedManifest.data.videos : [];
        const total = videos.length;
        const done = videos.filter((video) => video.status === "done").length;
        console.log(`  ${dir.name}  (${done}/${total} videos processed)`);
      } catch {
        console.log(`  ${dir.name}  (no manifest)`);
      }
    }
  } catch {
    console.log("No indices found. Run `ee process` to create one.");
  }
}
