/**
 * index-list command: lists all indices and their files recursively. Outputs JSON.
 */
import { readdir } from "node:fs/promises";
import { resolve, relative } from "node:path";
import { INDEX_DIR } from "../paths.js";

interface IndexEntry {
  index: string;
  files: string[];
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export default async function indexList(_args: string[]): Promise<void> {
  let topEntries: Awaited<ReturnType<typeof readdir<{ withFileTypes: true }>>>;
  try {
    topEntries = await readdir(INDEX_DIR, { withFileTypes: true });
  } catch {
    console.log(JSON.stringify([]));
    return;
  }

  const results: IndexEntry[] = [];

  for (const entry of topEntries) {
    if (!entry.isDirectory()) continue;

    const indexDir = resolve(INDEX_DIR, entry.name);
    const files = await walkDir(indexDir);
    const relativePaths = files
      .map((f) => relative(indexDir, f))
      .sort((a, b) => a.localeCompare(b));

    results.push({ index: entry.name, files: relativePaths });
  }

  results.sort((a, b) => a.index.localeCompare(b.index));
  console.log(JSON.stringify(results, null, 2));
}

async function walkDir(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = resolve(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walkDir(fullPath)));
    } else {
      files.push(fullPath);
    }
  }

  return files;
}
