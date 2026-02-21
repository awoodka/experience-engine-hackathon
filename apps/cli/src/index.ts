#!/usr/bin/env bun

const args = process.argv.slice(2);
const command = args[0];

const commands: Record<string, (args: string[]) => Promise<void>> = {
  process: (await import("./commands/process.js")).default,
  query: (await import("./commands/query.js")).default,
  score: (await import("./commands/score.js")).default,
  list: (await import("./commands/list.js")).default,
  status: (await import("./commands/status.js")).default,
  tutorial: (await import("./commands/tutorial.js")).default,
};

if (!command || command === "--help" || command === "-h") {
  console.log(`
  ee - Experience Engine CLI

  Commands:
    ee process [--index <name>] [--prompt <path>] [--model <id>] [--force] [--limit <n>]
                                                    Build/resume a behavioral index
    ee query <search> [--index <name>] [--limit <n>]
                                                    Search an index
    ee score [--index <name>] [--output <path>] [--limit <n>]
                                                    Compute heuristic scores from timelines
    ee list                                         Show all indices
    ee status [--index <name>]                      Show index processing progress
    ee tutorial render <id> [--model <id>]           Render data/tutorials/scripts/<id>.json → MP4
  `);
  process.exit(0);
}

const handler = commands[command];
if (!handler) {
  console.error(`Unknown command: ${command}`);
  process.exit(1);
}

await handler(args.slice(1));

export {};
