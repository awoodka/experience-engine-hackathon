/**
 * index-write command: reads stdin and writes to a file within an index.
 */
import { mkdir } from "node:fs/promises";
import { dirname, normalize, resolve } from "node:path";

import { getPositionals } from "../args.js";
import { INDEX_DIR } from "../paths.js";

export default async function indexWrite(args: string[]): Promise<void> {
  const positionals = getPositionals(args);
  const index = positionals[0];
  const filePath = positionals[1];

  if (!index || !filePath) {
    console.error("Usage: echo '<data>' | ee index-write <index> <path>");
    process.exit(1);
  }

  const normalized = normalize(filePath);
  if (normalized.startsWith("..") || normalized.includes("/../")) {
    console.error("Path traversal not allowed.");
    process.exit(1);
  }

  const targetPath = resolve(INDEX_DIR, index, normalized);

  // Ensure target is within the index directory
  const indexDir = resolve(INDEX_DIR, index);
  if (!targetPath.startsWith(indexDir)) {
    console.error("Path traversal not allowed.");
    process.exit(1);
  }

  const input = await Bun.stdin.text();
  if (!input) {
    console.error("No input received on stdin.");
    process.exit(1);
  }

  await mkdir(dirname(targetPath), { recursive: true });
  await Bun.write(targetPath, input);

  console.log(
    JSON.stringify(
      {
        ok: true,
        path: `data/index/${index}/${normalized}`,
        bytesWritten: Buffer.byteLength(input, "utf8"),
      },
      null,
      2,
    ),
  );
}
