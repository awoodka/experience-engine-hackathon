import { resolve } from "node:path";

const INDICES_DIR = resolve(
  import.meta.dirname,
  "../../../../data/.ee/indices",
);

export default async function status(args: string[]): Promise<void> {
  const index = getFlag(args, "index") ?? "default";
  const manifestPath = resolve(INDICES_DIR, index, "manifest.json");

  try {
    const manifest = await Bun.file(manifestPath).json();

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
