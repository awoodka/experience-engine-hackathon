import { resolve } from "node:path";
import { z } from "zod";

const INDICES_DIR = resolve(
  import.meta.dirname,
  "../../../../data/.ee/indices",
);

const statusManifestSchema = z.object({
  promptPath: z.string().nullable().optional(),
  promptHash: z.string().optional(),
  videos: z
    .array(
      z.object({
        name: z.string(),
        status: z.enum(["pending", "processing", "done", "error"]),
      }),
    )
    .catch([]),
});

export default async function status(args: string[]): Promise<void> {
  const index = getFlag(args, "index") ?? "default";
  const manifestPath = resolve(INDICES_DIR, index, "manifest.json");

  try {
    const manifestRaw: unknown = await Bun.file(manifestPath).json();
    const parsedManifest = statusManifestSchema.safeParse(manifestRaw);
    const manifest = parsedManifest.success
      ? parsedManifest.data
      : { promptPath: undefined, promptHash: undefined, videos: [] };

    console.log(`Index: ${index}`);
    console.log(`Prompt: ${manifest.promptPath ?? "default"}`);
    console.log(`Prompt hash: ${manifest.promptHash ?? "n/a"}`);
    console.log(`\nVideos:`);

    for (const video of manifest.videos ?? []) {
      const icon =
        video.status === "done" ? "+" : video.status === "error" ? "!" : "-";
      console.log(`  [${icon}] ${video.name}  ${video.status}`);
    }
  } catch {
    console.error(
      `No index found at "${index}". Run \`ee process --index ${index}\` first.`,
    );
    process.exit(1);
  }
}

function getFlag(args: string[], name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  return i !== -1 && i + 1 < args.length ? args[i + 1] : undefined;
}
