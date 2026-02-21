import { readdir } from "node:fs/promises";
import { resolve } from "node:path";

const INDICES_DIR = resolve(
  import.meta.dirname,
  "../../../../data/.ee/indices",
);

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
        const manifest = await Bun.file(manifestPath).json();
        const total = manifest.videos?.length ?? 0;
        const done =
          manifest.videos?.filter((v: any) => v.status === "done").length ?? 0;
        console.log(`  ${dir.name}  (${done}/${total} videos processed)`);
      } catch {
        console.log(`  ${dir.name}  (no manifest)`);
      }
    }
  } catch {
    console.log("No indices found. Run `ee process` to create one.");
  }
}
