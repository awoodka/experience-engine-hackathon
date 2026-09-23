# Experience Engine

Experience Engine is what our team, Brick & Morty, built in 36 hours at the UMD x Ironsite Startup Shell
Hackathon (February 20–22, 2026). It watches construction-site footage, looks for the small habits that
separate experienced workers from newer ones, and turns what it finds into short coaching videos cut from the
footage itself. We got an Honorable Mention. It wasn't quite what the judges were looking for, but they found
it interesting and technically challenging enough to recognize.

The code is as we left it at the end of the weekend. It's a prototype. It needs the hackathon's video
dataset, which isn't in this repo, and a logged-in Claude Code install.

## The idea

The theme was spatial intelligence in the physical world. Most spatial work in computer vision is geometric:
where a person is, how far they are from a wall, what angle their arm is at. We wanted to see if a model
could also say something about why a worker moves the way they do.

Our bet was that a lot of expertise shows up in the order of small actions. An experienced plumber checks
the joint and then brings the torch in. Someone newer checks, stops, and re-measures. So we break each
video segment into a sequence of task types (`check`, `carry`, `install`, `risky`, `idle`, `communicate`,
plus any the agent decides it needs) and look for four patterns in those sequences, which we called
implicit intents:

| Intent       | What the agent looks for                                                                                               |
| ------------ | ---------------------------------------------------------------------------------------------------------------------- |
| hesitation   | uncertainty or rework, such as carry → check → carry, install → check → install, or fetching the same thing repeatedly |
| coordination | hand-offs and waiting on a partner, such as carry → idle → install across workers, or communicate → carry → install    |
| attention    | checking before acting: check → risky, check → install, inspection before precision work                               |
| smoothness   | timing problems: segments under 5 seconds, high variance in segment length, erratic pacing                             |

Plenty of segments match none of these, and our instructions tell the agent to leave them empty rather than
force a pattern.

## How it works

There's less analysis code than you might expect. Most of the pipeline is a playbook,
[`.claude/skills/ee/SKILL.md`](.claude/skills/ee/SKILL.md), that Claude Code (Opus) follows, calling our
`ee` CLI for anything that touches video. The CLI wraps Gemini for watching video and ffmpeg for cutting
clips, grabbing frames and rendering.

1. Gemini watched each source video and wrote a timeline of segments: activity, tools, materials, spatial
   context, and signs of expertise or inefficiency. The command that did this first pass was folded into the
   general-purpose `ee video-analyze` partway through the weekend, so making a timeline for a new video now
   means running `ee video-analyze` on it with a prompt (and optionally a `--schema`) asking for those fields.
2. Claude reads each timeline and, for every segment, writes the task-type sequence, any intents it finds, a
   few named numbers (like `reworkCount` or `handoffGapSec`), a 0–100 score and a few sentences of reasoning.
   These are the model's judgments. Early on we had deterministic feature functions computing the scores, but
   we took them out during the hackathon and moved the whole step into the playbook.
3. For each intent, the agent cuts a clip and asks Gemini about body orientation, the distance the worker
   closes before acting, and how direct their movement is, marking each as an expert or novice signal. The
   prompt and schema are in [`scripts/backfill-spatial.ts`](scripts/backfill-spatial.ts).
4. All of this lands in a JSON "behavioral index" per video, which the CLI can search (BM25, via MiniSearch)
   and dump.
5. To make a tutorial, the agent picks moments from the index and confirms each clip really shows the
   behavior with `ee video-verify`, which asks Gemini. Then it writes a `config.json` of steps (narrate, play
   the clip, pause on a frame with a red box, root cause, takeaway). `ee tutorial-render` builds the MP4
   with an ffmpeg filter graph and refuses anything over 40 seconds. After that, `ee tutorial-review` checks
   each step against the rendered video, and `ee tutorial-assess` asks whether it teaches something beyond
   "here's a mistake". The agent loops until both pass.

Here's one intent from the index, trimmed. The angle, distance and ratio are Gemini's estimates from a
single camera, not measurements, and nobody outside the team has checked the reasoning.

```json
{
  "category": "attention",
  "taskSet": ["check", "risky"],
  "score": 90,
  "reasoning": "The check-to-risky task sequence demonstrates expertise through a deliberate and efficient pattern where the worker meticulously inspects the copper joint before introducing the high-heat flame.",
  "spatialIntelligence": {
    "bodyOrientation": {
      "label": "lean_in_for_precision",
      "observation": "The worker squares their torso and leans in at approximately a 20-degree angle to align the torch tip with the copper joint.",
      "expertSignal": true
    },
    "distanceBeforeAction": {
      "label": "close_gap_before_braze",
      "estimatedMeters": 0.3,
      "expertSignal": true
    },
    "trajectoryEfficiency": {
      "label": "direct_path",
      "efficiencyRatio": 0.95,
      "expertSignal": true
    }
  }
}
```

The web app's main page (`/`) is a chat with the agent. It streams from Claude Code through the Hono API,
and when the agent calls `ee present`, the clip or frame shows up inline. `/tutorials` is a gallery of
rendered tutorials. `/review` (labeled Feed) shows five hand-picked tutorials as a mock-up of a
superintendent's daily digest; those cards are hardcoded.

## Who built what

From the commit history:

- Stephen Shkeda set up the monorepo, the `ee` CLI and its later rewrite into small composable commands
  (index search included), the Hono API that runs Claude Code behind the chat, the Astro web app and its
  Feed and Tutorials pages, the tutorial renderer and `tutorial-review`, the team data sync, and the setup
  sections of the README we submitted to the hackathon.
- Anjali Sreenivasan built the scoring side: the first heuristic scoring pipeline, the behavioral index with
  its four intent categories (later moved into the playbook), the Gemini spatial analysis in
  `scripts/backfill-spatial.ts`, error handling in the API, and the approach write-up in that README.
- Alex Woodka built the tutorial side: the first tutorial generator and Tutorials page, tutorial validation
  in `scripts/validate-tutorials.ts`, grounding tutorial narration in the index's reasoning, the 40-second
  limit, `ee video-verify` and `ee tutorial-assess`.

## What isn't here

The footage and everything generated from it (timelines, indices, tutorials, chats) lived in `data/`, which
is gitignored. `bun run data-pull` fetches it from a private GitHub gist whose ID only the team has, so it
won't work for anyone else. The videos came from the dataset the organizers provided.

[EVIDENCE.md](EVIDENCE.md) lays out a blind comparison against a plain "summarize this video and give
coaching advice" baseline. We never ran it, so there's no measured evidence that the tutorials beat an
ordinary AI summary.

[DEMO.md](DEMO.md) describes where we wanted to go: find an experienced worker and a newer one doing the
same task and build the tutorial from the difference between them. That comparison never got built. The
tutorials we made point out one mistake and describe what an experienced worker would do instead.

## Running it

You'll need Bun 1.3.9, ffmpeg on your PATH, and Claude Code installed and logged in, since both the chat
API and the terminal agent drive it. The `gh` CLI is only used by the data sync.

```bash
bun install
cp apps/cli/.env.example apps/cli/.env   # add GOOGLE_GENERATIVE_AI_API_KEY and EE_GEMINI_MODEL
bun run dev                              # web on localhost:7891, API on localhost:7892
```

The env file lives in `apps/cli/` because `./ee` runs Bun from that directory, and Bun only loads `.env`
from its working directory. `EE_GEMINI_MODEL` can be any Gemini model ID that accepts video. Source videos
go in `data/videos/`. `bun run agent` (or `./agent.sh`) opens the
same agent in your terminal instead of the browser.

The CLI prints its full reference with `./ee --help`. The commands we used most:

```bash
./ee video-list
./ee video-analyze <file> "<prompt>" [--schema '<json>'] [--model <id>]
./ee video-clip <file> --start 10 --end 20
./ee video-frame <file> 15.0 [--region x,y,w,h]
./ee video-verify <file> "<short visual description>" [--start <sec>] [--end <sec>]
./ee index-list
./ee index-read <index> --search "<query>"
./ee index-read all --dump --stats
./ee tutorial-render <slug>
./ee tutorial-review <slug>
./ee tutorial-assess <slug>
```

`bun run check` formats and lints the code (it rewrites files in place) and validates whatever indices and
tutorials are in `data/`.

The chat API runs Claude Code with `bypassPermissions` so it can call the CLI without asking. Anyone who can
reach port 7892 can get it to run commands on your machine, so keep it on localhost.

## Other files

- [PROJECT.md](PROJECT.md): the pitch we wrote during the event
- [HACKATHON.md](HACKATHON.md): the event brief and judging criteria
- [DEMO.md](DEMO.md): the demo script for the expert-versus-newcomer tutorial
- [EVIDENCE.md](EVIDENCE.md): the evaluation plan, not run
- [AGENTS.md](AGENTS.md): repo notes for the coding agents we worked with
- [`.claude/skills/ee/SKILL.md`](.claude/skills/ee/SKILL.md): the playbook the analysis and tutorials run on
- [`scripts/`](scripts/): one-off passes over the data (spatial backfill, the implicit-intent index and a
  Gemini spot check of it, the activity log) and the validators behind `bun run check`

Built with Bun and Turborepo, Hono, Astro with React, Tailwind and shadcn/ui, Gemini through the Vercel AI
SDK, Claude Code through `ai-sdk-provider-claude-code`, ffmpeg, and Zod.
