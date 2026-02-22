---
name: ee
auto-apply: true
description: Query and manage Experience Engine video behavioral indices. Use when the user asks about worker behavior, activities, expertise, inefficiencies, safety, tools, or anything related to construction site video analysis.
allowed-tools: Bash(./ee *), Read, Write
---

# Experience Engine CLI

The `./ee` CLI provides composable tools for analyzing construction-site video and
managing behavioral indices. All commands output JSON to stdout.

## Data Layout

```
data/
  index/<name>/
    schema.json                  # Entry shape — read before writing
    entries/<video>.json         # One file per source video
  tutorials/<slug>/
    config.json                  # Tutorial script
    video.mp4 / thumb.jpg / meta.json
  videos/                        # Source video files
```

## CLI Reference

### Video Tools

**`./ee video-list`** — Lists videos in `data/videos/`. Returns `[{name, path, sizeBytes}]`.

**`./ee video-clip <file> --start <sec> [--end <sec>] [--region x,y,w,h]`** — Extracts an MP4 clip to `data/tmp/clips/`. Optional `--region` draws a red bounding box (normalized 0–1). Not shown to user — use `present` when ready.

**`./ee video-analyze <file> "<prompt>" [--schema '<json-schema>']`** — Sends video/clip to Gemini. Without `--schema`: raw text. With `--schema`: structured JSON output. To analyze a specific section, extract a clip first.

**`./ee video-frame <file> <seconds> [--region x,y,w,h]`** — Extracts a JPEG frame. Optional `--region` draws a red bounding box. Entry mode: `./ee video-frame --index <index> --file <subpath> --entry <n>`. Not shown to user — use `present` when ready.

**`./ee video-verify <file> "<activity>" [--start <sec>] [--end <sec>]`** — Checks whether a visible activity is the main subject of a clip. Returns `{found, confidence, reason}`. The `<activity>` must be a SHORT visual description (≤15 words) of what the viewer literally sees — not a behavioral analysis. Only use clips where `found: true` and confidence is `"high"` or `"medium"`.

**`./ee present <path>`** — Shows an image or video to the user in chat. Call ONLY when ready to present a final result — not during intermediate exploration.

### Index Tools

**`./ee index-list`** — Lists all indices and their entry files.

**`./ee index-create <name>`** — Scaffolds `data/index/<name>/entries/`.

**`./ee index-read <index> <path>`** — Reads a file from an index.

**`./ee index-read <index> --search "<query>" [--field <name> --value <val>] [--after <sec> --before <sec>] [--top N]`** — Full-text search across an index (BM25). Returns `[{file, path, score, data}]`.

**`./ee index-read <index> --dump [--raw] [--stats] [--field <name> --value <val>]`** — All entries. `--raw` strips wrappers, `--stats` gives aggregate statistics.

**Cross-index:** `./ee index-read all --dump` or `./ee index-read safety,productivity --search "fall protection"`.

**`./ee index-write <index> <path>`** — Reads stdin, writes to index file. Returns `{ok, path, bytesWritten}`.

### Tutorial Tools

**`./ee tutorial-render <slug>`** — Renders `config.json` → `video.mp4` + `thumb.jpg` + `meta.json`. Fails if tutorial exceeds 40 seconds. Not shown to user — use `present` when ready.

**`./ee tutorial-review <slug>`** — Sends config + rendered video to Gemini. Verifies every step matches its intent. Returns `{pass, steps: [{stepIndex, stepType, ok, issue}], summary}`. Fix any `ok: false` steps, re-render, re-review.

**`./ee tutorial-assess <slug>`** — Evaluates whether the tutorial teaches experience (not just shows a mistake). Returns `{teachesExperience, issues, suggestions, summary}`. Fix issues, re-render, re-review, re-assess until `teachesExperience: true`.

---

## Behavioral Index

The `behavioral` index contains agentic behavioral analysis per video. Structure:

```
video
 └─ segments[]
     ├─ segmentIndex, startSec, endSec, activity
     ├─ taskTypeSequence   — ordered labels, e.g. ["carry","check","install"]
     └─ implicitIntents[]  — detected behavior patterns (can be empty)
         ├─ category       — hesitation | coordination | attention | smoothness
         ├─ taskSet        — sub-sequence that triggered it
         ├─ startSec / endSec
         ├─ features       — named numeric values
         ├─ score          — 0–100 (internal only — never expose to user)
         ├─ reasoning      — 3+ sentences mixing behavioral + spatial observations
         └─ spatialIntelligence
             ├─ bodyOrientation      { label, observation, expertSignal }
             ├─ distanceBeforeAction { label, estimatedMeters, observation, expertSignal }
             └─ trajectoryEfficiency { label, efficiencyRatio, observation, expertSignal }
```

Empty `implicitIntents: []` means no signal — nothing is force-fit.

### Intent Categories

| Category       | What it captures                                             |
| -------------- | ------------------------------------------------------------ |
| `hesitation`   | Uncertainty / rework — carry→check→carry, repeated same task |
| `coordination` | Hand-offs, waiting on partner, sync events                   |
| `attention`    | Deliberate check-before-act — verify→install, inspect→risky  |
| `smoothness`   | Timing disruptions — micro-stops, erratic pacing             |

Task-type vocabulary: `data/index/behavioral/task-vocab.json`.
Spatial dimension labels: `data/index/behavioral/spatial-vocab.json`.

### Querying

**Never expose raw score numbers to the user.** Scores are for sorting and filtering internally. Describe behavior qualitatively — the `reasoning` field already does this.

When answering questions about worker behavior:

1. **Search** — `./ee index-read behavioral --search "<topic>"`
2. **Read full entry** — `./ee index-read behavioral entries/<name>.json`
3. **Filter by category** — find relevant `implicitIntents`
4. **Quote `reasoning`** — it is 3+ sentences mixing behavioral + spatial observations
5. **Cite `spatialIntelligence`** — body orientation, distance (meters), trajectory (ratio)
6. **Cite timestamps** — `startSec`–`endSec` and `taskSet` for concrete evidence
7. **Rank by score internally** — but describe results qualitatively, never numerically

---

## Generating the Behavioral Index

When asked to run behavioral analysis, you do this directly — no scripts. Read timelines, reason over them, analyze video clips for spatial signals, write output.

### Step 1 — Read vocabularies

```
Read data/index/behavioral/task-vocab.json
Read data/index/behavioral/spatial-vocab.json
```

### Step 2 — Find timeline files

```
ls data/.ee/indices/construction/timelines/
```

### Step 3 — For each timeline, generate a behavioral entry

Read the timeline. For each segment, reason through:

**A. Task type sequence** — Break the activity into ordered task-type labels from the vocab. Only add new types if genuinely needed; update `task-vocab.json` when you do.

**B. Implicit intent detection** — Scan for sub-sequences that reveal:

- **hesitation**: carry→check→carry, install→check→install, repeated retrieval
- **coordination**: carry→idle→install across workers, communicate→carry→install
- **attention**: check→risky, check→install, inspection before precision work
- **smoothness**: segments under 5s, high duration variance, erratic pacing

Leave `implicitIntents: []` if no genuine signal. Do NOT force-fit.

**C. Features** — Named numeric values per intent (e.g. `reworkCount`, `handoffGapSec`, `verificationCount`, `microStopCount`).

**D. Spatial intelligence** — For each intent, extract a clip and run Gemini spatial analysis. The canonical prompt and schema are in `scripts/backfill-spatial.ts` (constants `SPATIAL_PROMPT` and `SPATIAL_SCHEMA`). Read that file for the full prompt. It evaluates three dimensions: body orientation, distance before action, trajectory efficiency — each classified as expert or novice signal.

```bash
./ee video-clip data/<video> --start <startSec> --end <endSec>
./ee video-analyze <clip.mp4> "<spatial-prompt>" --schema '<spatial-schema>'
```

Never fabricate spatial data. If Gemini can't determine a dimension, omit it.

**E. Score + reasoning** — Score 0–100 (100 = expert). Write 3+ sentences:

1. What the task-type sequence reveals (behavioral)
2. What body/distance/trajectory data adds (spatial) — cite specific numbers
3. Combined interpretation — skill level, what to change, why the behavior makes sense

### Step 4 — Write output

```
echo '<json>' | ./ee index-write behavioral entries/<videoName>.json
```

### Step 5 — Update task vocab if extended

---

## Tutorial Creation

### Voice

Source all narration from `reasoning` + `spatialIntelligence` fields in the behavioral index. Never invent narration.

Open with the category signal, stated plainly:

| Category     | Opening                                 |
| ------------ | --------------------------------------- |
| hesitation   | "This is the hesitation — ..."          |
| attention    | "This is the attention gap — ..."       |
| smoothness   | "This is where the rhythm breaks — ..." |
| coordination | "This is the coordination gap — ..."    |

Cite specific spatial numbers — meters, ratios, body angles. "He stayed 0.6m back" not "he was far away."

Expert contrast is mandatory after every mistake. State the physical pattern an expert uses.

Write like a foreman, not a document:

- **Bad:** "The worker's task sequence reveals hesitation caused by over-application of material."
- **Good:** "This is the hesitation — he over-loads the trowel, then scrapes back the excess before the block can go down."

### Structure

Tutorials must be **≤ 40 seconds**. Duration formulas:

- **narrate/takeaway/root-cause/impact**: `min(8, max(2, ceil(text.length / 20)))` seconds
- **play**: `endSec - startSec` (capped at 40s; divided by `slowMo` if set)
- **pause**: `min(8, max(3, ceil(description.length / 20)))` seconds

Each behavioral moment follows five steps:

1. **narrate** — Name the problem. From `reasoning` + spatial observations.
2. **play** — Verified clip showing the behavior. Must have `description` field (≤15 words, visual).
3. **pause** — Freeze on key frame. Red bounding box on the failure. Caption ≤8 words.
4. **root-cause** — Why experts don't do this. What they do instead. Cite spatial pattern.
5. **takeaway** — One concrete physical action the viewer can try tomorrow.

A 40-second tutorial typically has 4–7 steps total.

### Workflow

**1. Find behavioral moments.** Read behavioral entries for relevant videos. Pick `implicitIntents` with clear signal.

```
./ee index-read behavioral entries/<video>.json
./ee index-read behavioral --search "hesitation"
```

**2. Verify every clip BEFORE writing config.** Write a SHORT visual description (≤15 words) of what the viewer would literally see. Not behavioral analysis — what is visible on screen.

- Bad: "The transition from communication to a risky task shows a significant failure in planning"
- Good: "Worker stops mid-lift and re-approaches the wall frame with a grinder"

```
./ee video-verify data/videos/<video> "<short visual description>" --start <sec> --end <sec>
```

If `found: false` or `confidence: "low"` — discard that timestamp, try another.

**3. Verify every bounding box.** Extract the annotated frame, confirm the box highlights the right thing:

```
./ee video-frame data/videos/<file> <seconds> --region x,y,w,h
./ee video-analyze <frame.jpg> "Does the red box highlight <what description says>?"
```

**4. Draft config.json.** Add up durations before saving. Must be ≤40 seconds.

Every `play` step needs a `description` — the short visual description from step 2 (confirmed by `video-verify`).

**5. Validate → render → review → assess.** Run in this order, loop until clean:

```bash
bun check                          # Schema + duration validation
./ee tutorial-render <slug>        # Render video
./ee tutorial-review <slug>        # Verify clips match intent
./ee tutorial-assess <slug>        # Verify it teaches experience
```

Fix any issues. Re-run from `bun check`. Do NOT present until BOTH `tutorial-review` passes AND `tutorial-assess` returns `teachesExperience: true`.

**6. Present.** Only after both checks are clean:

```
./ee present data/tutorials/<slug>/video.mp4
```

---

## Self-Correction

Don't blindly trust index data. When something seems off:

1. Pull the frame: `./ee video-frame data/videos/<file> <seconds>`
2. If it has a bounding box, render it: `--region x,y,w,h`
3. Check it — does it match the description?
4. If wrong, fix it: read the file, correct the entry, write it back.

The index is a living document. If you find errors while answering a question, fix them on the spot.
