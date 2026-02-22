# Experience Engine

**Team Brick & Morty** | UMD x Ironsite Startup Shell Hackathon 2025

AI-powered construction site video analysis that identifies expert techniques and generates targeted coaching tutorials — turning the best worker's muscle memory into everyone's skill set.

## The Problem

The best workers on a construction site carry knowledge no manual has ever captured. After thousands of hours of repetition, they've developed micro-habits that make them faster, safer, and more consistent. But they can't teach what they can't articulate. New workers figure it out alone, make the same mistakes for months, and some never catch up.

Experience Engine watches job site video, builds a searchable behavioral index of every action and technique, then connects the dots: who's great at what, who's struggling, and what specific behavior would close the gap.

## How It Works

1. **Video In** — Helmet-mounted and site cameras capture raw job site footage.
2. **Behavioral Index** — Gemini analyzes video segments and extracts structured timelines: activities, tools, expertise signals, hesitation patterns, spatial context, and more.
3. **Search Engine** — A Claude agent queries the entire behavioral dataset through a conversational interface. Compare workers, find patterns, identify teaching opportunities.
4. **Tutorial Generation** — Auto-generate annotated coaching tutorials from real footage, pairing expert technique with areas for improvement.

## Structure

Bun + Turborepo monorepo.

```
apps/
  api/     Hono API — chat streaming, tutorial serving (port 7892)
  cli/     ee CLI — video analysis, indexing, search, tutorial rendering
  web/     Astro + React frontend — chat, tutorials, daily review (port 7891)
data/
  videos/     Source video files
  index/      Behavioral indices (behavioral, construction, expert-technique, ...)
  tutorials/  Generated tutorials (config.json, video.mp4, thumb.jpg)
scripts/      Validation, backfill, sync utilities
```

## Getting Started

```bash
# Install dependencies
bun install

# Set up environment
cp .env.example .env
# Add GOOGLE_GENERATIVE_AI_API_KEY and EE_GEMINI_MODEL

# Pull data from GitHub
bun run data-pull

# Start dev servers
bun run dev
```

The web app runs at `localhost:7891`, proxying API requests to `localhost:7892`.

## CLI

The `ee` CLI is the primary tool for video analysis and index management.

```bash
./ee --help
```

**Video**

```bash
./ee video-list                                  # List source videos
./ee video-analyze <file> "<prompt>"             # Analyze with Gemini
./ee video-clip <file> --start 10 --end 20       # Extract clip
./ee video-frame <file> 15.0                     # Extract single frame
./ee video-verify <file> "<activity>"            # Verify clip shows activity
```

**Index**

```bash
./ee index-list                                  # List all indices
./ee index-read <index> --search "<query>"       # Full-text search
./ee index-read <index> --dump --stats           # Dump with aggregations
./ee index-read all --dump                       # Cross-index search
```

**Tutorials**

```bash
./ee tutorial-render <slug>                      # Render tutorial to MP4
./ee tutorial-review <slug>                      # Validate rendered video
./ee tutorial-assess <slug>                      # Evaluate teaching quality
```

## Commands

| Command             | Description                                  |
| ------------------- | -------------------------------------------- |
| `bun run dev`       | Start all dev servers                        |
| `bun run build`     | Build all workspaces                         |
| `bun run check`     | Format, lint, validate indices and tutorials |
| `bun run data-pull` | Pull data from GitHub                        |
| `bun run data-push` | Push data to GitHub                          |

## Tech Stack

- **Runtime:** Bun, Turborepo
- **AI:** Google Gemini (video analysis), Claude (agent + chat)
- **API:** Hono
- **Web:** Astro, React, Tailwind, shadcn/ui
- **Video:** FFmpeg
- **Validation:** Zod, TypeScript (strict ESM)
