#!/usr/bin/env bun

const args = process.argv.slice(2);
const command = args[0];

const commands: Record<string, (args: string[]) => Promise<void>> = {
  "video-list": (await import("./commands/video-list.js")).default,
  "video-clip": (await import("./commands/video-clip.js")).default,
  "video-analyze": (await import("./commands/video-analyze.js")).default,
  "video-frame": (await import("./commands/video-frame.js")).default,
  "video-verify": (await import("./commands/video-verify.js")).default,
  "index-list": (await import("./commands/index-list.js")).default,
  "index-read": (await import("./commands/index-read.js")).default,
  "index-write": (await import("./commands/index-write.js")).default,
  "index-create": (await import("./commands/index-create.js")).default,
  "tutorial-render": (await import("./commands/tutorial-render.js")).default,
  "tutorial-review": (await import("./commands/tutorial-review.js")).default,
  present: (await import("./commands/present.js")).default,
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
    ee video-verify <file> "<activity>" [--start <sec>] [--end <sec>]
                                                        Verify a clip shows an activity

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

  Presentation:
    ee present <path>                                 Show an image or video to the user

  Tutorial Tools:
    ee tutorial-render <slug>                         Render tutorial to MP4
    ee tutorial-review <slug>                         Review rendered video against config.json
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
