/**
 * index-create command: scaffolds a new index directory with a starter schema.
 *
 * Usage: ee index-create <name>
 *
 * Creates data/index/<name>/entries/ and a schema.json stub.
 */
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { INDEX_DIR } from "../paths.js";

const STARTER_SCHEMA = {
  description: "",
  type: "array",
  scoring: null,
  items: {
    type: "object",
    required: ["timestamp_sec", "description"],
    properties: {
      timestamp_sec: {
        type: "number",
        description: "When this occurs in the video (seconds)",
      },
      description: {
        type: "string",
        description: "What was observed",
      },
    },
  },
};

export default async function indexCreate(args: string[]): Promise<void> {
  const name = args[0];

  if (!name) {
    console.error("Usage: ee index-create <name>");
    process.exit(1);
  }

  if (!/^[a-z][a-z0-9-]*$/.test(name)) {
    console.error(
      "Index name must be lowercase kebab-case (e.g. 'safety', 'site-photos').",
    );
    process.exit(1);
  }

  const indexDir = resolve(INDEX_DIR, name);

  if (existsSync(indexDir)) {
    console.error(`Index "${name}" already exists at ${indexDir}`);
    process.exit(1);
  }

  const entriesDir = resolve(indexDir, "entries");
  await mkdir(entriesDir, { recursive: true });

  const schemaPath = resolve(indexDir, "schema.json");
  await Bun.write(schemaPath, JSON.stringify(STARTER_SCHEMA, null, 2) + "\n");

  console.log(
    JSON.stringify(
      {
        ok: true,
        index: name,
        path: `data/index/${name}/`,
        next: `Edit data/index/${name}/schema.json to define the entry structure for this index.`,
      },
      null,
      2,
    ),
  );
}
