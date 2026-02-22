#!/usr/bin/env bun

/**
 * Validates all index entry files against their schema.json.
 *
 * Checks:
 * - Every entries/*.json file is valid JSON
 * - Every entries/*.json file is an array (or object if entryFormat: "object")
 * - Every item has the required fields defined in schema.json
 * - Every index directory has a schema.json
 */
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const INDEX_DIR = join(import.meta.dir, "../data/index");

interface SchemaItem {
  required?: string[];
  properties?: Record<string, unknown>;
}

interface ScoringConfig {
  field: string;
  type: string;
  order: string;
  range?: unknown;
  levels?: unknown;
}

interface Schema {
  description?: string;
  type: string;
  scoring?: ScoringConfig | null;
  entryFormat?: "array" | "object";
  items?: SchemaItem;
}

let errors = 0;

function error(msg: string) {
  console.error(`  ✗ ${msg}`);
  errors++;
}

async function main() {
  if (!existsSync(INDEX_DIR)) {
    console.log("No data/index/ directory — nothing to validate.");
    return;
  }

  const indices = await readdir(INDEX_DIR, { withFileTypes: true });

  for (const entry of indices) {
    if (!entry.isDirectory()) continue;

    const indexDir = join(INDEX_DIR, entry.name);
    const schemaPath = join(indexDir, "schema.json");
    const entriesDir = join(indexDir, "entries");

    console.log(`${entry.name}/`);

    // Check schema.json exists
    if (!existsSync(schemaPath)) {
      error("Missing schema.json");
      continue;
    }

    let schema: Schema;
    try {
      schema = JSON.parse(await readFile(schemaPath, "utf8"));
    } catch {
      error("schema.json is not valid JSON");
      continue;
    }

    // Validate scoring config if present
    if (schema.scoring != null) {
      const s = schema.scoring;
      const props = schema.items?.properties ?? {};

      if (typeof s.field !== "string" || !s.field) {
        error("scoring.field must be a non-empty string");
      } else if (!(s.field in props)) {
        error(`scoring.field "${s.field}" not found in items.properties`);
      }

      if (s.type !== "numeric" && s.type !== "ordinal") {
        error(`scoring.type must be "numeric" or "ordinal", got "${s.type}"`);
      }

      if (s.order !== "asc" && s.order !== "desc") {
        error(`scoring.order must be "asc" or "desc", got "${s.order}"`);
      }

      if (s.type === "numeric") {
        if (
          !Array.isArray(s.range) ||
          s.range.length !== 2 ||
          typeof s.range[0] !== "number" ||
          typeof s.range[1] !== "number"
        ) {
          error("scoring.range must be [min, max] (two numbers)");
        } else if (s.range[0] >= s.range[1]) {
          error("scoring.range[0] must be less than scoring.range[1]");
        }
      }

      if (s.type === "ordinal") {
        if (!Array.isArray(s.levels) || s.levels.length < 2) {
          error("scoring.levels must be an array of 2+ strings");
        } else if (!s.levels.every((l: unknown) => typeof l === "string")) {
          error("scoring.levels must contain only strings");
        }
      }
    }

    const requiredFields = schema.items?.required ?? [];

    // Check entries
    if (!existsSync(entriesDir)) {
      console.log("  (no entries/ directory)");
      continue;
    }

    const files = await readdir(entriesDir);
    const jsonFiles = files.filter((f) => f.endsWith(".json"));

    if (jsonFiles.length === 0) {
      console.log("  (no entries)");
      continue;
    }

    for (const file of jsonFiles) {
      const filePath = join(entriesDir, file);

      let parsed: unknown;
      try {
        parsed = JSON.parse(await readFile(filePath, "utf8"));
      } catch {
        error(`entries/${file}: invalid JSON`);
        continue;
      }

      const expectObject = schema.entryFormat === "object";

      if (expectObject) {
        // Per-file object entries (e.g. behavioral: one object per video)
        if (
          parsed == null ||
          typeof parsed !== "object" ||
          Array.isArray(parsed)
        ) {
          error(
            `entries/${file}: expected object, got ${Array.isArray(parsed) ? "array" : typeof parsed}`,
          );
          continue;
        }
      } else {
        // Default: array of items
        if (!Array.isArray(parsed)) {
          error(`entries/${file}: expected array, got ${typeof parsed}`);
          continue;
        }

        // Check required fields on each item
        for (let i = 0; i < parsed.length; i++) {
          const item = parsed[i];
          if (item == null || typeof item !== "object") {
            error(`entries/${file}[${i}]: expected object`);
            continue;
          }
          for (const field of requiredFields) {
            if (!(field in item)) {
              error(`entries/${file}[${i}]: missing required field "${field}"`);
            }
          }
        }
      }
    }

    console.log(`  ✓ ${jsonFiles.length} file(s) valid`);
  }

  if (errors > 0) {
    console.error(`\n${errors} error(s) found.`);
    process.exit(1);
  }
}

await main();
