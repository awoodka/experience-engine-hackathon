/**
 * index-read command: reads files from an index or performs full-text search.
 *
 * Mode A (direct read):  ee index-read <index> <path>
 * Mode B (search):       ee index-read <index> --search "<query>" [--raw] [--field <name> --value <val>] [--after <sec> --before <sec>] [--top N]
 * Mode C (dump):         ee index-read <index> --dump [--raw] [--stats] [--field <name> --value <val>] [--after <sec> --before <sec>] [--top N]
 *
 * Cross-index:           ee index-read --all --dump [--raw] [--stats]
 *                        ee index-read safety,productivity --search "fall protection"
 */
import { readdir, readFile } from "node:fs/promises";
import { extname, relative, resolve } from "node:path";
import MiniSearch from "minisearch";

import { getFlag, getPositionals } from "../args.js";
import { INDEX_DIR } from "../paths.js";

interface SearchHit {
  index?: string;
  file: string;
  path: string;
  score: number;
  data: unknown;
}

interface ScoringConfig {
  field: string;
  type: "numeric" | "ordinal";
  order: "asc" | "desc";
  range?: [number, number];
  levels?: string[];
}

export default async function indexRead(args: string[]): Promise<void> {
  const positionals = getPositionals(args, ["--dump", "--raw", "--stats"]);
  const indexArg = positionals[0];

  if (!indexArg) {
    console.error("Usage: ee index-read <index> <path>");
    console.error(
      '       ee index-read <index> --search "<query>" [--raw] [--top N]',
    );
    console.error(
      "       ee index-read <index> --dump [--raw] [--stats] [--top N]",
    );
    console.error(
      '       ee index-read --all --search "<query>"  (cross-index)',
    );
    process.exit(1);
  }

  const search = getFlag(args, "search");
  const dump = args.includes("--dump");

  if (search != null || dump) {
    // Resolve which indices to query
    const indexNames = await resolveIndexNames(indexArg);
    const raw = args.includes("--raw");
    const stats = args.includes("--stats");
    const multi = indexNames.length > 1;

    let allHits: SearchHit[] = [];
    for (const idx of indexNames) {
      const hits = await searchSingleIndex(idx, search ?? "", args, dump);
      if (multi) {
        for (const h of hits) h.index = idx;
      }
      allHits.push(...hits);
    }

    // For search mode across multiple indices, re-sort by score
    if (multi && search) {
      allHits.sort((a, b) => b.score - a.score);
    }

    // Apply --top limit
    const topN = parseOptionalNumber(getFlag(args, "top"));
    if (topN != null && topN > 0) {
      allHits = allHits.slice(0, topN);
    }

    if (stats) {
      console.log(JSON.stringify(computeStats(allHits, multi), null, 2));
    } else if (raw) {
      const rawData = multi
        ? allHits.map((h) => ({
            index: h.index,
            ...injectSource(h.data, h.file),
          }))
        : allHits.map((h) => injectSource(h.data, h.file));
      console.log(JSON.stringify(rawData, null, 2));
    } else {
      console.log(JSON.stringify(allHits, null, 2));
    }
  } else {
    const filePath = positionals[1];
    if (!filePath) {
      console.error(
        "Usage: ee index-read <index> <path>  OR  --search <query>  OR  --dump",
      );
      process.exit(1);
    }
    await readIndexFile(indexArg, filePath);
  }
}

// ---------------------------------------------------------------------------
// Index name resolution (supports "all", comma-separated, single)
// ---------------------------------------------------------------------------

async function resolveIndexNames(indexArg: string): Promise<string[]> {
  if (indexArg === "all" || indexArg === "--all") {
    return listAllIndices();
  }
  if (indexArg.includes(",")) {
    return indexArg.split(",").map((s) => s.trim());
  }
  return [indexArg];
}

async function listAllIndices(): Promise<string[]> {
  const entries = await readdir(INDEX_DIR, { withFileTypes: true });
  return entries
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
}

// ---------------------------------------------------------------------------
// Direct file read
// ---------------------------------------------------------------------------

async function readIndexFile(index: string, filePath: string): Promise<void> {
  const fullPath = resolve(INDEX_DIR, index, filePath);
  const indexDir = resolve(INDEX_DIR, index);

  if (!fullPath.startsWith(indexDir)) {
    console.error("Path traversal not allowed.");
    process.exit(1);
  }

  try {
    const content = await readFile(fullPath, "utf8");
    console.log(content);
  } catch {
    console.error(`File not found: ${index}/${filePath}`);
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Search with MiniSearch
// ---------------------------------------------------------------------------

/** Fields we always extract from every object for MiniSearch */
const DEFAULT_FIELDS = [
  "description",
  "activity",
  "category",
  "type",
  "title",
  "phase",
  "recommendation",
  "impact",
  "tools",
  "text",
  "label",
  "trade",
  "notes",
  "reason",
  "video",
];

/** Default boost weights when no schema-specific weights are available */
const DEFAULT_BOOST: Record<string, number> = {
  description: 5,
  activity: 5,
  category: 5,
  type: 5,
  title: 5,
  phase: 4,
  recommendation: 4,
  impact: 3,
  tools: 3,
  text: 3,
  label: 2,
  trade: 2,
  video: 1,
  notes: 1,
  reason: 1,
};

/** Keys that indicate structural-only objects (not meaningful search results) */
const STRUCTURAL_KEYS = new Set(["x", "y", "w", "h"]);

interface SearchDoc {
  id: string;
  file: string;
  jsonPath: string;
  data: unknown;
  // Dynamic string fields for MiniSearch:
  [key: string]: unknown;
}

async function searchSingleIndex(
  index: string,
  query: string,
  args: string[],
  dump: boolean,
): Promise<SearchHit[]> {
  const indexDir = resolve(INDEX_DIR, index);
  const fieldName = getFlag(args, "field");
  const fieldValue = getFlag(args, "value");
  const afterSec = parseOptionalNumber(getFlag(args, "after"));
  const beforeSec = parseOptionalNumber(getFlag(args, "before"));

  const scoring = await loadScoringConfig(indexDir);
  const boostWeights = DEFAULT_BOOST;
  const fields = DEFAULT_FIELDS;

  let jsonFiles: string[];
  try {
    jsonFiles = await walkJsonFiles(indexDir);
  } catch {
    console.error(`Index not found: ${index}`);
    process.exit(1);
  }

  // Collect searchable documents
  const docs: SearchDoc[] = [];
  let docId = 0;

  for (const filePath of jsonFiles) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(await readFile(filePath, "utf8"));
    } catch {
      continue;
    }

    const relPath = relative(indexDir, filePath);
    const objects = collectSearchableObjects(parsed, relPath, "");

    for (const obj of objects) {
      // Time filter
      if (!passesTimeFilter(obj.data, afterSec, beforeSec)) continue;

      // Field filter
      if (fieldName && fieldValue) {
        if (!matchesFieldFilter(obj.data, fieldName, fieldValue)) continue;
      }

      // Build document with extracted string fields for MiniSearch
      const doc: SearchDoc = {
        id: String(docId++),
        file: obj.file,
        jsonPath: obj.jsonPath,
        data: obj.data,
      };

      // Extract known fields as strings for indexing
      if (obj.data != null && typeof obj.data === "object") {
        const record = obj.data as Record<string, unknown>;
        for (const field of fields) {
          if (field in record) {
            doc[field] = stringifyField(record[field]);
          }
        }
      }

      docs.push(doc);
    }
  }

  if (dump || !query) {
    const hits = docs.map((d) => ({
      file: d.file,
      path: d.jsonPath,
      score: scoring
        ? Math.round(computeDomainScore(d.data, scoring) * 100) / 100
        : 0,
      data: d.data,
    }));
    if (scoring) hits.sort((a, b) => b.score - a.score);
    return hits;
  }

  // Search mode: use MiniSearch
  const ms = new MiniSearch<SearchDoc>({
    fields,
    idField: "id",
    storeFields: ["file", "jsonPath", "data"],
  });

  ms.addAll(docs);

  const results = ms.search(query, {
    boost: boostWeights,
    prefix: true,
    fuzzy: 0.2,
  });

  const maxTextScore =
    results.reduce((max, r) => Math.max(max, r.score), 0) || 1;

  if (!scoring) {
    return results.map((r) => ({
      file: r.file as string,
      path: r.jsonPath as string,
      score: Math.round((r.score / maxTextScore) * 100) / 100,
      data: r.data,
    }));
  }
  const blended = results.map((r) => ({
    file: r.file as string,
    path: r.jsonPath as string,
    score:
      Math.round(
        (0.6 * (r.score / maxTextScore) +
          0.4 * computeDomainScore(r.data, scoring)) *
          100,
      ) / 100,
    data: r.data,
  }));
  blended.sort((a, b) => b.score - a.score);
  return blended;
}

// ---------------------------------------------------------------------------
// Schema-driven scoring
// ---------------------------------------------------------------------------

async function loadScoringConfig(
  indexDir: string,
): Promise<ScoringConfig | null> {
  try {
    const raw = JSON.parse(
      await readFile(resolve(indexDir, "schema.json"), "utf8"),
    );
    const s = raw?.scoring;
    if (!s || typeof s !== "object") return null;
    if (
      typeof s.field !== "string" ||
      (s.type !== "numeric" && s.type !== "ordinal") ||
      (s.order !== "asc" && s.order !== "desc")
    )
      return null;
    return s as ScoringConfig;
  } catch {
    return null;
  }
}

function computeDomainScore(data: unknown, scoring: ScoringConfig): number {
  if (data == null || typeof data !== "object") return 0;
  const record = data as Record<string, unknown>;
  const value = record[scoring.field];

  if (scoring.type === "numeric") {
    if (typeof value !== "number" || !scoring.range) return 0;
    const [min, max] = scoring.range;
    if (max === min) return 0;
    const normalized = Math.max(0, Math.min(1, (value - min) / (max - min)));
    return scoring.order === "desc" ? normalized : 1 - normalized;
  }

  if (scoring.type === "ordinal") {
    if (typeof value !== "string" || !scoring.levels) return 0;
    const idx = scoring.levels.indexOf(value);
    if (idx === -1) return 0;
    const normalized = idx / (scoring.levels.length - 1);
    return scoring.order === "desc" ? normalized : 1 - normalized;
  }

  return 0;
}

// ---------------------------------------------------------------------------
// Stats aggregation
// ---------------------------------------------------------------------------

function computeStats(
  hits: SearchHit[],
  multi: boolean,
): Record<string, unknown> {
  const result: Record<string, unknown> = { totalEntries: hits.length };

  if (multi) {
    const byIndex: Record<string, number> = {};
    for (const h of hits) {
      const idx = h.index ?? "unknown";
      byIndex[idx] = (byIndex[idx] ?? 0) + 1;
    }
    result.byIndex = byIndex;
  }

  // Collect all field keys and classify them
  const stringCounts: Record<string, Record<string, number>> = {};
  const numericValues: Record<string, number[]> = {};

  for (const h of hits) {
    if (h.data == null || typeof h.data !== "object") continue;
    const record = h.data as Record<string, unknown>;

    for (const [key, val] of Object.entries(record)) {
      if (key === "video" || key === "region") continue;

      if (typeof val === "string") {
        if (!stringCounts[key]) stringCounts[key] = {};
        const normalized = val.toLowerCase();
        stringCounts[key][normalized] =
          (stringCounts[key][normalized] ?? 0) + 1;
      } else if (typeof val === "number") {
        if (!numericValues[key]) numericValues[key] = [];
        numericValues[key].push(val);
      } else if (Array.isArray(val)) {
        if (!stringCounts[key]) stringCounts[key] = {};
        for (const item of val) {
          if (typeof item === "string") {
            const normalized = item.toLowerCase();
            stringCounts[key][normalized] =
              (stringCounts[key][normalized] ?? 0) + 1;
          }
        }
      }
    }
  }

  // Build field summaries
  const fields: Record<string, unknown> = {};

  for (const [key, counts] of Object.entries(stringCounts)) {
    const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
    fields[key] = {
      unique: sorted.length,
      distribution: Object.fromEntries(sorted),
    };
  }

  for (const [key, values] of Object.entries(numericValues)) {
    const sorted = values.sort((a, b) => a - b);
    const sum = sorted.reduce((a, b) => a + b, 0);
    fields[key] = {
      count: sorted.length,
      min: sorted[0],
      max: sorted[sorted.length - 1],
      avg: Math.round((sum / sorted.length) * 100) / 100,
      median: sorted[Math.floor(sorted.length / 2)],
    };
  }

  result.fields = fields;
  return result;
}

// ---------------------------------------------------------------------------
// Object collection — walks JSON and extracts searchable records
// ---------------------------------------------------------------------------

function collectSearchableObjects(
  obj: unknown,
  file: string,
  jsonPath: string,
): Array<{ file: string; jsonPath: string; data: unknown }> {
  if (obj == null || typeof obj !== "object") return [];

  if (Array.isArray(obj)) {
    const results: Array<{ file: string; jsonPath: string; data: unknown }> =
      [];
    for (let i = 0; i < obj.length; i++) {
      results.push(
        ...collectSearchableObjects(obj[i], file, `${jsonPath}[${i}]`),
      );
    }
    return results;
  }

  const keys = Object.keys(obj);
  const results: Array<{ file: string; jsonPath: string; data: unknown }> = [];

  // This object is a searchable record if it has 2+ keys and isn't structural
  if (keys.length >= 2 && !isStructuralObject(keys)) {
    results.push({ file, jsonPath: jsonPath || "(root)", data: obj });
  }

  // Recurse into nested objects/arrays, but skip structural keys
  for (const key of keys) {
    const value = (obj as Record<string, unknown>)[key];
    if (value != null && typeof value === "object") {
      const childPath = jsonPath ? `${jsonPath}.${key}` : key;
      results.push(...collectSearchableObjects(value, file, childPath));
    }
  }

  return results;
}

function isStructuralObject(keys: string[]): boolean {
  return keys.length <= 4 && keys.every((k) => STRUCTURAL_KEYS.has(k));
}

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------

function passesTimeFilter(
  data: unknown,
  afterSec: number | undefined,
  beforeSec: number | undefined,
): boolean {
  if (afterSec == null && beforeSec == null) return true;
  if (data == null || typeof data !== "object") return true;

  const record = data as Record<string, unknown>;

  // Try startSec/endSec first (construction), then timestamp_sec/duration_sec (safety/productivity)
  const startSec =
    getNumericField(record, "startSec") ??
    getNumericField(record, "timestamp_sec");
  const endSec =
    getNumericField(record, "endSec") ??
    (startSec != null
      ? startSec + (getNumericField(record, "duration_sec") ?? 0)
      : null);

  if (startSec == null && endSec == null) return true;
  if (afterSec != null && endSec != null && endSec < afterSec) return false;
  if (beforeSec != null && startSec != null && startSec > beforeSec)
    return false;

  return true;
}

function matchesFieldFilter(
  obj: unknown,
  field: string,
  value: string,
): boolean {
  if (obj == null || typeof obj !== "object") return false;
  const record = obj as Record<string, unknown>;
  const valueLower = value.toLowerCase();

  if (field in record) {
    const fieldVal = record[field];
    if (typeof fieldVal === "string") {
      return fieldVal.toLowerCase().includes(valueLower);
    }
    if (typeof fieldVal === "number" || typeof fieldVal === "boolean") {
      return String(fieldVal).toLowerCase() === valueLower;
    }
    if (Array.isArray(fieldVal)) {
      return fieldVal.some(
        (v) => typeof v === "string" && v.toLowerCase().includes(valueLower),
      );
    }
  }

  return false;
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function toRecord(data: unknown): Record<string, unknown> {
  if (data != null && typeof data === "object" && !Array.isArray(data)) {
    return data as Record<string, unknown>;
  }
  return { value: data };
}

/** Inject a `video` field derived from the source filename when the data lacks one. */
function injectSource(data: unknown, file: string): unknown {
  const record = toRecord(data);
  if (!("video" in record)) {
    const base = file.replace(/^entries\//, "").replace(/\.json$/, "");
    return { ...record, video: `${base}.mp4` };
  }
  return data;
}

function stringifyField(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  if (Array.isArray(value)) return value.map(stringifyField).join(", ");
  return "";
}

function getNumericField(
  record: Record<string, unknown>,
  field: string,
): number | undefined {
  const val = record[field];
  return typeof val === "number" ? val : undefined;
}

async function walkJsonFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = resolve(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walkJsonFiles(fullPath)));
    } else if (extname(entry.name).toLowerCase() === ".json") {
      files.push(fullPath);
    }
  }

  return files;
}

function parseOptionalNumber(value: string | undefined): number | undefined {
  if (value == null) return undefined;
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : undefined;
}
