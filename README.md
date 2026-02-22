# Experience Engine

**Team Brick & Morty** | UMD x Ironsite Startup Shell Hackathon 2026

AI-powered construction site video analysis that identifies expert techniques and generates targeted coaching tutorials — turning the best worker's muscle memory into everyone's skill set.

## The Problem

The best workers on a construction site carry knowledge no manual has ever captured. After thousands of hours of repetition, they've developed micro-habits that make them faster, safer, and more consistent. But they can't teach what they can't articulate. New workers figure it out alone, make the same mistakes for months, and some never catch up.

Experience Engine watches job site video, builds a searchable behavioral index of every action and technique, then connects the dots: who's great at what, who's struggling, and what specific behavior would close the gap.

## Our Approach: Spatial Intelligence Meets Implicit Intent

Traditional spatial intelligence in computer vision is geometric — where is the person, how far are they from the wall, what is the angle of their arm. That tells you *what* is happening in space.

We pushed the frontier further: **spatial intelligence should also encode behavior and intent, not just geometry.**

Experts on a job site are constantly making micro-decisions they aren't consciously aware of. They check before they cut. They close the distance before they braze. They pivot from a fixed position instead of walking back and forth. They communicate before a risky overhead lift. None of this is written in a manual. It lives in their body, built up over years of practice.

By grounding spatial observations in task sequences and implicit intent categories, we made it possible for an AI to say not just *"the worker was close to the pipe"* but *"the worker closed the gap before brazing because that is what experts do."* That is a different kind of intelligence — one that understands the **why behind the where**.

## How It Works

The pipeline runs end-to-end from raw video to a queryable behavioral index that an AI can reason over. Here is the full flow.

### Step 1 — Gemini clips the video and extracts spatial context

Raw site footage goes into Gemini, which segments the video into discrete activity windows and extracts structured data for each one: what is happening, who is involved, what tools are present, and critically — **spatial signals** about how the worker's body is moving through space.

This is where spatial intelligence enters the picture. Gemini observes things like:
- **Body orientation** — is the worker squared to the target or working at an awkward angle?
- **Distance before action** — did they close the gap before starting, or are they overreaching?
- **Trajectory efficiency** — are they moving in a direct line, pivoting in place, or backtracking?

These are not just geometric measurements. They are behavioral signals. A 20-degree torso lean before brazing is not a random pose — it is how an expert positions themselves for precision heat control. Spatial intelligence, combined with what the worker is doing, starts to reveal *why* they are moving that way.

### Step 2 — Classify each clip into task types

Each video clip is then classified into a task type that captures the *intent* behind the action, not just the activity label. The core task types are:

- `check` — inspecting, measuring, verifying, aligning
- `risky` — cutting, drilling, brazing, lifting, pressing — high-stakes actions
- `carry` — transporting, retrieving, staging materials
- `install` — fitting, assembling, placing, mounting
- `communicate` — coordinating with another worker before acting
- `idle` — waiting, pausing, standing without active engagement

Classification is done by LLM reasoning, not keywords. A worker "positioning blocks" while holding a level is classified as `check`, not `install` — because the *intent* is verification. That distinction drives everything downstream.

And critically: **Claude dynamically generates new task types as it learns from more videos.** The model is not constrained to a fixed taxonomy. As it encounters new trades, new workflows, and new behavioral patterns, it expands the vocabulary to match.

### Step 3 — Group task type sequences into implicit intent sets

Once clips are classified, the pipeline groups consecutive task types into sets that map to one of four **implicit intent categories** — the behavioral fingerprints of expertise:

| Implicit Intent | Task Type Mapping | What it reveals |
| --------------- | ----------------- | --------------- |
| **Attention** | `check` → `risky` | The worker verified before acting on a high-stakes task |
| **Hesitation** | `check` → `idle` | The worker stopped after inspecting — no mental pre-plan for next steps |
| **Coordination** | `communicate` → `risky` | The worker aligned with their partner before a dangerous move |
| **Smoothness** | `carry` → `carry` → `carry` | Repeated trips reveal whether materials were staged efficiently |

For example: a plumber who inspects a copper joint (`check`) and then immediately introduces the torch (`risky`) maps to **Attention** — an expert signal. The same plumber who inspects and then stands still for 15 seconds maps to **Hesitation** — a gap in pre-planning.

This is the simplest version of the mapping. The actual pipeline goes further, tracking multi-step sequences, overlapping patterns, and context across the full video timeline.

### Step 4 — Compute scores with feature functions

For each detected implicit intent pattern, **feature functions** compute scores (0–100) that quantify how well or poorly the behavior was executed. Each implicit intent category has its own set of features:

- **Hesitation** features: gap between tasks, unnecessary tool switches, rework loops
- **Attention** features: whether a `check` preceded the `risky` action and how recently
- **Coordination** features: handoff speed from `carry` to `install`, wait time between workers
- **Smoothness** features: micro-stop count, variance in segment durations

These feature functions are seeded by us — but like task types, **they can be dynamically generated as the model learns more.** As the system encounters new trades and new behavioral patterns, it can propose and register new features that better capture what expertise looks like in that domain.

All computed scores, raw context values, and spatial observations are written into a structured behavioral index as JSON.

### Step 5 — The AI queries the index and produces reasoned output

A Claude agent queries the behavioral index using `./ee query` and produces natural-language reasoning that explains what the worker did, why it matters, and what it signals about their skill level:

```json
{
  "category": "attention",
  "taskSet": ["check", "risky"],
  "score": 90,
  "reasoning": "The check-to-risky task sequence demonstrates expertise through a deliberate and efficient pattern where the worker meticulously inspects the copper joint before introducing the high-heat flame. This physical technique is supported by expert signals, as the worker closed to a consistent 0.3m distance before brazing and maintained a direct trajectory efficiency ratio of 0.95. This performance is correct and worth repeating because the worker squares their torso to the joint, ensuring the torch tip remains perfectly aligned for a uniform heat distribution.",
  "spatialIntelligence": {
    "bodyOrientation": {
      "label": "lean_in_for_precision",
      "observation": "The worker squares their torso and leans in at approximately a 20-degree angle to align the torch tip with the copper joint.",
      "expertSignal": true
    },
    "distanceBeforeAction": {
      "label": "close_gap_before_braze",
      "estimatedMeters": 0.3,
      "observation": "The worker maintains a consistent working distance of about 0.3 meters between the torch nozzle and the pipe throughout the brazing sequence.",
      "expertSignal": true
    },
    "trajectoryEfficiency": {
      "label": "direct_path",
      "efficiencyRatio": 0.95,
      "observation": "The worker moves the torch in a direct line between the two pipe joints with no wandering or backtracking observed.",
      "expertSignal": true
    }
  }
}
```

An AI watched a plumber braze copper pipe in a cramped corner closet and produced reasoning that a master plumber would recognize as accurate. The 20-degree lean, the 0.3m working distance, the check-before-flame sequence — none of those behaviors were labeled in the source video. They were inferred.

**This is pushing the frontier.** AI systems can detect objects, estimate poses, and measure distances. What they have not been able to do is explain implicit behavior — the instincts and micro-decisions that make someone an expert. Experience Engine does that.

### Step 6 — Generate targeted coaching tutorials

The AI takes its reasoned output and turns it into actionable coaching. It identifies what a worker did wrong, what the expert version of that behavior looks like, and generates an annotated tutorial from real footage — pairing the mistake with the correction, explained in plain language.

This is the product. Not a report. Not a dashboard. A teaching moment, generated automatically from the job site itself.

### Step 7 — The vision: pairing skilled workers with unskilled ones

With a wider dataset, the full vision becomes possible. Experience Engine identifies an expert worker and an unskilled one doing the same task, surfaces the implicit behavioral gap between them — the things the expert does that they cannot articulate — and creates an in-house teaching opportunity.

No external training. No generic safety videos. The best person on your crew becomes the curriculum, and every new hire gets coached on the real skills that drive efficiency, safety, and speed on that specific job site.

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
