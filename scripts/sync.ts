#!/usr/bin/env bun

/**
 * Team data sync via a secret GitHub Gist.
 *
 * Usage:
 *   bun upload   — Push local data/ to the team
 *   bun sync     — Pull the latest data/ from the team
 *
 * On first `bun upload`, a secret gist is created and its ID is saved to .gist-id.
 * Share the .gist-id file with your team (it's gitignored).
 * The gist is completely separate from this repo — stays private even if the repo goes public.
 *
 * Requires: `gh` CLI (authenticated)
 */

import { $, Glob } from "bun";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { createHash } from "crypto";

const ROOT = join(import.meta.dir, "..");
const DATA_DIR = join(ROOT, "data");
const GIST_ID_FILE = join(ROOT, ".gist-id");
const ARCHIVE = "ee-data.tar.gz";

interface SyncMeta {
  hash: string;
  user: string;
  timestamp: string;
}

async function computeHash(): Promise<string> {
  const hash = createHash("sha256");
  const glob = new Glob("**/*");
  const files: string[] = [];

  for await (const file of glob.scan({ cwd: DATA_DIR, onlyFiles: true })) {
    if (file.startsWith("videos/") || file.startsWith("tmp/")) continue;
    files.push(file);
  }

  files.sort();

  for (const file of files) {
    const content = await Bun.file(join(DATA_DIR, file)).arrayBuffer();
    hash.update(file);
    hash.update(new Uint8Array(content));
  }

  return hash.digest("hex").slice(0, 12);
}

function getGistId(): string | null {
  if (!existsSync(GIST_ID_FILE)) return null;
  return readFileSync(GIST_ID_FILE, "utf-8").trim() || null;
}

async function getRemoteMeta(gistId: string): Promise<SyncMeta | null> {
  const result = await $`gh gist view ${gistId} -f sync-meta.json`
    .text()
    .catch(() => "");
  if (!result.trim()) return null;
  try {
    return JSON.parse(result.trim());
  } catch {
    return null;
  }
}

async function upload() {
  if (!existsSync(DATA_DIR)) {
    console.error(
      "Error: No data/ directory found. Run 'bun ee' to create data first.",
    );
    process.exit(1);
  }

  const localHash = await computeHash();
  const user = (await $`whoami`.text()).trim();
  const timestamp = new Date().toISOString();
  const meta: SyncMeta = { hash: localHash, user, timestamp };

  // Create tarball of data/ directory, excluding videos (too large for gist)
  await $`tar -czf /tmp/${ARCHIVE} -C ${ROOT} --exclude='data/videos' --exclude='data/tmp' data`;

  // Base64 encode it so it can live in a gist (gists are text-only)
  await $`base64 -i /tmp/${ARCHIVE} -o /tmp/ee-data.b64`;

  // Write metadata
  await Bun.write("/tmp/sync-meta.json", JSON.stringify(meta, null, 2));

  const gistId = getGistId();

  if (gistId) {
    // Check if already up to date
    const remote = await getRemoteMeta(gistId);
    if (remote?.hash === localHash) {
      console.log("Remote is already up to date with your local data.");
      return;
    }
    if (remote) {
      console.warn(
        `\x1b[33m⚠ Overwriting remote data from ${remote.user} (${remote.timestamp})\x1b[0m`,
      );
    }

    console.log(`Packing data (hash: ${localHash})...`);
    await $`gh gist edit ${gistId} -a /tmp/sync-meta.json -a /tmp/ee-data.b64`;
  } else {
    console.log(`Packing data (hash: ${localHash})...`);
    // Create a new secret gist
    const result =
      await $`gh gist create /tmp/sync-meta.json /tmp/ee-data.b64 -d "experience-engine data sync"`.text();
    // Extract gist ID from the URL output
    const url = result.trim().split("\n").pop()!.trim();
    const newId = url.split("/").pop()!;
    await Bun.write(GIST_ID_FILE, newId);
    console.log(`Created secret gist: ${url}`);
    console.log(`Gist ID saved to .gist-id — share this file with your team.`);
  }

  console.log(
    `\x1b[32m✓\x1b[0m Uploaded by ${user} at ${timestamp} (hash: ${localHash})`,
  );
  console.log("Team members can run \x1b[1mbun sync\x1b[0m to get this data.");
}

async function sync() {
  const gistId = getGistId();
  if (!gistId) {
    console.error(
      "Error: No .gist-id file found. Either run 'bun upload' first, or get the .gist-id file from a teammate.",
    );
    process.exit(1);
  }

  const meta = await getRemoteMeta(gistId);
  if (!meta) {
    console.error(
      "Error: No data has been uploaded yet. Run 'bun upload' first.",
    );
    process.exit(1);
  }

  // Check for local changes / conflicts
  if (existsSync(DATA_DIR)) {
    const localHash = await computeHash();
    if (localHash === meta.hash) {
      console.log("Already up to date.");
      return;
    }
    console.warn(
      `\x1b[33m⚠ Local data (${localHash}) differs from remote (${meta.hash}).\x1b[0m`,
    );
    console.warn(`  Remote was uploaded by ${meta.user} at ${meta.timestamp}`);
    console.warn(
      "  Remote files will be merged into local data/ (no deletions). Press Ctrl+C to abort.",
    );
    await Bun.sleep(3000);
  }

  // Download and decode — extract on top of existing data (additive, no deletions)
  console.log(`Downloading data from ${meta.user} (${meta.timestamp})...`);

  await $`gh gist view ${gistId} -f ee-data.b64 > /tmp/ee-data.b64`;
  await $`base64 -d -i /tmp/ee-data.b64 -o /tmp/${ARCHIVE}`;
  await $`tar -xzf /tmp/${ARCHIVE} -C ${ROOT}`;

  console.log(
    `\x1b[32m✓\x1b[0m Synced! Data from ${meta.user} (hash: ${meta.hash})`,
  );
}

// --- Main ---

const command = process.argv[2];

if (command === "upload") {
  await upload();
} else if (command === "sync" || !command) {
  await sync();
} else {
  console.log("Usage:");
  console.log("  bun upload  — Push local data/ for your team");
  console.log("  bun sync    — Pull latest data/ from your team");
  process.exit(1);
}
