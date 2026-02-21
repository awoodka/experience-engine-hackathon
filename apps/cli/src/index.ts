#!/usr/bin/env bun

const args = process.argv.slice(2);
const command = args[0];

const commands: Record<string, (args: string[]) => Promise<void>> = {
  "video-list": (await import("./commands/video-list.js")).default,
  "video-clip": (await import("./commands/video-clip.js")).default,
  "video-analyze": (await import("./commands/video-analyze.js")).default,
  "video-frame": (await import("./commands/video-frame.js")).default,
  "index-list": (await import("./commands/index-list.js")).default,
  "index-read": (await import("./commands/index-read.js")).default,
  "index-write": (await import("./commands/index-write.js")).default,
  "index-create": (await import("./commands/index-create.js")).default,
  "script-render": (await import("./commands/script-render.js")).default,
  "script-verify": (await import("./commands/script-verify.js")).default,
  tutorial: (await import("./commands/tutorial.js")).default,
};

if (!command || command === "--help" || command === "-h") {
  console.log(`
  ee - Experience Engine CLI

  Video Tools:
    ee video-list                                     List video files in data/
    ee video-clip <file> --start <sec> [--end <sec>] [--region x,y,w,h]
                                                        Extract a clip to MP4
    ee video-analyze <file> "<prompt>" [--model <id>] [--schema '<json>']
                                                        Analyze video with Gemini
    ee video-frame <file> <seconds> [--region x,y,w,h] Extract a single frame
    ee video-frame --index <idx> --file <path> --entry <n>
                                                        Frame from index entry

  Index Tools:
    ee index-list                                     List all indices and files
    ee index-create <name>                            Scaffold a new index
    ee index-read <index> <path>                      Read file from index
    ee index-read <index> --search "<query>" [--raw] [--top N]
                                                      Search across index files
    ee index-read <index> --dump [--raw] [--stats] [--top N]
                                                      Dump all entries (with optional filters)
    ee index-read all --dump [--raw] [--stats]        Cross-index dump (all indices)
    ee index-read safety,productivity --search "<q>"  Cross-index search
    ee index-write <index> <path>                     Write data to index (stdin)

    Shared flags: [--field <name> --value <val>] [--after <sec> --before <sec>]
      --raw    Strip wrapper, output flat data array
      --stats  Aggregate statistics (field distributions, numeric summaries)

  Tutorial Tools:
    ee tutorial render <id> [--model <gemini-model>]  Render tutorial script to MP4
    ee script-render <slug>                           Render tutorial to MP4
    ee script-verify <slug>                           Extract frames for review
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
