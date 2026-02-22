---
name: ee
auto-apply: true
description: Query and manage Experience Engine video behavioral indices. Use when the user asks about worker behavior, activities, expertise, inefficiencies, safety, tools, or anything related to construction site video analysis.
allowed-tools: Bash(./ee *), Read, Write
---

# Experience Engine CLI Tools

The `./ee` CLI provides composable primitives for analyzing construction-site video
and managing behavioral indices. All commands output JSON to stdout.

## Data Layout

```
data/
  index/
    <name>/
      schema.json                     # Entry shape (JSON Schema) — read before writing
      entries/<video>.json            # One file per source video, array of timestamped items
  tutorials/<slug>/config.json         # Agent-generated video tutorial scripts
  tutorials/<slug>/video.mp4           # Rendered tutorial video
  tutorials/<slug>/thumb.jpg           # Thumbnail
  tutorials/<slug>/meta.json           # Metadata (includes configHash)
  videos/                             # Source video files
  tmp/                                # Temporary files (frames, clips)
```

Every index has a `schema.json` that defines the entry structure. Read it before
generating entries. Every entry file is a JSON array of timestamped items, one
file per source video.

## Tools

### `./ee video-list`

Lists video files in `data/videos/`. Returns `[{name, path, sizeBytes}]`.

### `./ee video-clip <file> --start <sec> [--end <sec>] [--region x,y,w,h]`

Extracts a clip from a video and saves it as an MP4 in `data/tmp/clips/`.
Returns `{"type": "clip", "path": "data/tmp/clips/..."}`. The clip is **not**
shown to the user automatically — use `./ee present <path>` when you're ready.

- The MP4 file persists, so you can pass it to `video-analyze` or other commands.
- Optional `--region` draws a red bounding box (normalized 0–1 coordinates).

### `./ee video-analyze <file> "<prompt>" [--model <id>] [--schema '<json-schema>']`

Sends a video (or clip) to Gemini with your prompt.

- **Without `--schema`**: returns raw text.
- **With `--schema`**: enforces structured output via Gemini's JSON mode.
- To analyze a specific section, extract a clip first with `video-clip` and pass
  the resulting MP4 file to this command.

### `./ee video-frame <file> <seconds> [--region x,y,w,h]`

Extracts a JPEG frame at the given timestamp. Optionally draws a red bounding
box when `--region` is provided (normalized 0–1 coordinates).
Returns `{"type": "frame", "path": "...", seconds, region?}`. The frame is
**not** shown to the user automatically — use `./ee present <path>` when ready.

**Entry mode**: Pull video, timestamp, and region from an index entry:

```
./ee video-frame --index <index> --file <subpath> --entry <n>
```

### `./ee index-list`

Lists all indices and their files. Returns `[{index, files: [...]}]`.

### `./ee index-create <name>`

Scaffolds a new index directory at `data/index/<name>/entries/`.

### `./ee index-read <index> <path>`

Reads a file from an index. Returns raw contents.

### `./ee index-read <index> --search "<query>" [--field <name> --value <val>] [--after <sec> --before <sec>] [--top N]`

Full-text search across all JSON files in an index (BM25 ranking).
Returns `[{file, path, score, data}]`.

### `./ee index-read <index> --dump [--raw] [--stats] [--field <name> --value <val>] [--after <sec> --before <sec>] [--top N]`

Returns all entries from the index. Can be combined with field and time filters.

- `--raw` strips the `{file, path, score, data}` wrapper and outputs flat data.
- `--stats` outputs aggregate statistics (field distributions, numeric min/max/avg/median).

### Cross-index queries

```
./ee index-read all --dump [--raw] [--stats]
./ee index-read safety,productivity --search "fall protection"
```

Query multiple indices at once. Results are tagged with an `index` field and
re-sorted by score across indices.

### `./ee index-write <index> <path>`

Reads stdin and writes to a file in the index. Returns `{ok, path, bytesWritten}`.

### `./ee present <path>`

Shows an image or video to the user in the chat. Call this **only when you are
ready to present** a result — not during intermediate exploration. The command
detects the media type from the file extension and emits the format the frontend
renders inline.

```
./ee present data/tmp/frames/abc_62.0.jpg    # shows image
./ee present data/tmp/clips/clip_xyz.mp4     # shows video
./ee present data/tmp/my_tutorial.mp4        # shows rendered tutorial
```

### `./ee tutorial-render <slug>`

Renders `data/tutorials/<slug>/config.json` into an MP4. Outputs:

- `data/tutorials/<slug>/video.mp4` — the rendered video
- `data/tutorials/<slug>/thumb.jpg` — thumbnail (first frame)
- `data/tutorials/<slug>/meta.json` — metadata for the web UI

Returns `{"type": "clip", "path": "data/tutorials/<slug>/video.mp4"}`.
The video is **not** shown automatically — use `./ee present <path>` when ready.

### `./ee tutorial-review <slug>`

Reads `config.json` and `video.mp4` for the given slug, then asks Gemini to
verify every step in the rendered video against its intent.

Returns structured JSON:

```json
{
  "pass": true,
  "steps": [
    { "stepIndex": 0, "stepType": "narrate", "ok": true, "issue": "" },
    {
      "stepIndex": 1,
      "stepType": "play",
      "ok": false,
      "issue": "Clip shows wrong area of site."
    }
  ],
  "summary": "Step 1 shows the wrong clip. All other steps are correct."
}
```

Fix any `ok: false` steps in config.json, re-render, and re-review until `pass` is true.

## Behavioral Index

The `behavioral` index contains **agentic behavioral analysis** per video —
generated by Claude reading construction timelines and analyzing the source video
for spatial signals. Each entry file covers one video and is structured as:

```
video
 └─ segments[]
     ├─ segmentIndex, startSec, endSec, activity
     ├─ taskTypeSequence   — ordered action labels, e.g. ["carry","check","install"]
     └─ implicitIntents[]  — detected behaviour patterns (can be empty)
         ├─ category       — "hesitation" | "coordination" | "attention" | "smoothness"
         ├─ taskSet        — sub-sequence that triggered it, e.g. ["carry","check","carry"]
         ├─ startSec / endSec  — exact video timestamps
         ├─ features       — named numeric values, e.g. { toolSwitchCount: 2 }
         ├─ score          — 0–100 (100 = expert-like)
         ├─ reasoning      — 3+ sentence explanation mixing behavioral + spatial observations
         └─ spatialIntelligence  — spatial signals extracted from video for this window
             ├─ bodyOrientation      { label, observation }
             ├─ distanceBeforeAction { label, estimatedMeters, observation }
             └─ trajectoryEfficiency { label, efficiencyRatio, observation }
```

Empty `implicitIntents: []` means no clear behavioural signal was detected for
that segment — nothing is force-fit.

The four intent categories:

| Category       | What it captures                                             |
| -------------- | ------------------------------------------------------------ |
| `hesitation`   | Uncertainty / rework — carry→check→carry, repeated same task |
| `coordination` | Hand-offs, waiting on partner, sync events                   |
| `attention`    | Deliberate check-before-act (verify→install, inspect→risky)  |
| `smoothness`   | Timing disruptions — micro-stops (<5 s), erratic pacing      |

The shared task-type vocabulary lives at `data/index/behavioral/task-vocab.json`.
The spatial intelligence vocabulary lives at `data/index/behavioral/spatial-vocab.json`.

### Spatial Intelligence — Three Dimensions

Each `spatialIntelligence` block captures three orthogonal physical signals:

**1. Body Orientation** — posture and facing direction before/during action.
Labels from `spatial-vocab.json → bodyOrientation`. Examples:
- `face_target_before_act` — turned to face work object before initiating
- `square_up_before_lift` — squared hips/shoulders to load before lifting
- `retreat_for_clearance` — stepped back to create safety clearance
- `overhead_extension` — arms raised above shoulders for ceiling-level work
- `angled_away_from_target` — off-axis body position during precision task

**2. Worker-Object Distance Before Action** — how close the worker got before
committing to the action. Labels from `spatial-vocab.json → distanceBeforeAction`.
Estimated in meters. Examples:
- `close_gap_before_cut` — < 0.3m from cut surface before grinder/torch
- `reposition_until_comfortable` — multiple stance adjustments before committing
- `overreach_no_reposition` — acted at full arm extension, reducing control
- `consistent_working_distance` — stable, repeatable proximity throughout

**3. Trajectory Efficiency** — path quality from origin to work point.
Ratio = straight-line distance / actual path length (1.0 = perfectly direct).
Labels from `spatial-vocab.json → trajectoryEfficiency`. Examples:
- `direct_path` — efficiency > 0.85, minimal wasted movement
- `search_pattern` — efficiency < 0.40, no clear target path
- `backtrack_detected` — moved toward target, reversed, re-approached
- `stationary_pivot` — achieved reposition by rotating in place

### How to extract spatial intelligence from video

For each intent window, extract the clip and send to Gemini with the spatial prompt:

```bash
./ee video-clip data/<videoName> --start <startSec> --end <endSec>
./ee video-analyze <clip.mp4> "<spatial-prompt>" --schema '<spatial-schema>'
```

**Spatial analysis prompt template:**
```
Analyze this construction video clip for spatial worker behavior.
For body orientation: describe how the worker positioned their body relative to the work object.
  Did they face the target before acting? Square up before a lift? Retreat for clearance?
  Pick the single best label: face_target_before_act | square_up_before_lift | lean_in_for_precision |
  angled_away_from_target | overhead_extension | crouch_low_position | scan_before_move |
  pivot_to_partner | brace_against_surface | retreat_for_clearance
For distance before action: estimate how close (in meters) the worker was to the work surface
  at the moment they initiated the main action. Pick the best label:
  close_gap_before_cut | close_gap_before_install | close_gap_before_braze |
  maintain_safe_distance | overreach_no_reposition | reposition_until_comfortable |
  consistent_working_distance | variable_working_distance
For trajectory efficiency: observe the worker's movement path. Estimate the ratio of
  straight-line distance to actual path length (0.0–1.0). Pick the best label:
  direct_path | minor_deviation | significant_deviation | search_pattern |
  stationary_pivot | backtrack_detected | parallel_approach
Return a one-sentence observation for each dimension describing exactly what you see.
```

**Spatial analysis JSON schema** (pass as `--schema`):
```json
{
  "type": "object",
  "properties": {
    "bodyOrientation": {
      "type": "object",
      "properties": {
        "label": { "type": "string" },
        "observation": { "type": "string" }
      },
      "required": ["label", "observation"]
    },
    "distanceBeforeAction": {
      "type": "object",
      "properties": {
        "label": { "type": "string" },
        "estimatedMeters": { "type": "number" },
        "observation": { "type": "string" }
      },
      "required": ["label", "estimatedMeters", "observation"]
    },
    "trajectoryEfficiency": {
      "type": "object",
      "properties": {
        "label": { "type": "string" },
        "efficiencyRatio": { "type": "number" },
        "observation": { "type": "string" }
      },
      "required": ["label", "efficiencyRatio", "observation"]
    }
  },
  "required": ["bodyOrientation", "distanceBeforeAction", "trajectoryEfficiency"]
}
```

### Querying the behavioral index

**Search for a behaviour pattern:**

```
./ee index-read behavioral --search "hesitation"
./ee index-read behavioral --search "carry check carry"
./ee index-read behavioral --search "tool switch rework"
```

**Read a full video entry:**

```
./ee index-read behavioral entries/05_production_mp.json
```

**List all behavioral entry files:**

```
./ee index-list
```

### Answering user questions from behavioral data

When a user asks about worker skill, hesitation, attention, coordination, smoothness,
body position, distance, or movement efficiency — follow this pattern:

1. **Search** for relevant behaviour: `./ee index-read behavioral --search "<topic>"`
2. **Read the full entry** for videos with strong signal: `./ee index-read behavioral entries/<name>.json`
3. **Locate the intent instances** — filter for the relevant `category`
4. **Quote the `reasoning` field** directly — it's 3+ sentences mixing behavioral + spatial observations
5. **Cite `spatialIntelligence`** observations (body orientation, distance, trajectory) for physical evidence
6. **Cite timestamps** (`startSec`–`endSec`) and `taskSet` for concrete evidence
7. **Compare scores** across videos or segments to rank performance

**Example flow** — "Which workers showed the most hesitation?":

1. `./ee index-read behavioral --search "hesitation"`
2. Read top entries, collect all `implicitIntents` where `category === "hesitation"`
3. Sort by `score` ascending (low score = more hesitation)
4. Cite `reasoning` and timestamps for each instance

**Example flow** — "Show me good check-before-act behaviour":

1. `./ee index-read behavioral --search "attention verification check"`
2. Find instances where `category === "attention"` and `score >= 80`
3. Note `startSec`/`endSec`, optionally extract a clip for the user

**To teach workers what to improve**, combine behavioral reasoning with
construction timeline data:

1. Find low-scoring intent instances from the behavioral index
2. Read their `reasoning` — this is your training script
3. Optionally extract the video clip: `./ee video-clip data/videos/<file> --start <startSec> --end <endSec>`
4. Present the clip alongside the reasoning

---

## Generating the Behavioral Index

When the user asks you to **run behavioral analysis**, **generate the behavioral index**,
or **analyze worker behaviour** across videos — you do this work directly. No script,
no separate pipeline. You read the timelines, reason over them, analyze the video clips
for spatial signals, and write the output.

### Step 1 — Read the shared vocabularies

```
Read data/index/behavioral/task-vocab.json
Read data/index/behavioral/spatial-vocab.json
```

If task-vocab doesn't exist yet, start with this seed vocab:
```json
{
  "carry": "Transport, move, retrieve, or hand off materials or tools",
  "check": "Inspect, verify, measure, or align something before acting",
  "communicate": "Verbal or gestural communication between workers",
  "idle": "Pause, wait, or stand without active task engagement",
  "install": "Join, press, fit, insert, or permanently fix something into position",
  "navigate": "Walk, reposition, or move through the work site",
  "organize": "Sort, store, clean up, or arrange materials and tools",
  "risky": "Perform a high-risk precision action: cut, drill, lift, press, strike"
}
```

### Step 2 — Find all timeline files

```
ls data/.ee/indices/construction/timelines/
```

Each file is `<hash>.timeline.json`.

### Step 3 — For each timeline file, generate a behavioral entry

Read the timeline:

```
Read data/.ee/indices/construction/timelines/<hash>.timeline.json
```

Then for each segment in `timeline.segments`, reason through four stages:

**A. Task type sequence**
Break the segment's `activity` description into an ordered list of task-type labels
from the vocab. Use existing types where they fit. Only add new types if genuinely
needed — coin new types sparingly and add them to `task-vocab.json` when you do.

Example: `"Retrieving ProPress tool from gang box"` → `["navigate", "carry"]`
Example: `"Aligning copper pipe manifold before pressing"` → `["check", "carry", "check", "install"]`

**B. Implicit intent detection**
Scan the task type sequence for sub-sequences that genuinely reveal one of:

- **hesitation** — uncertainty/rework: `carry→check→carry`, `install→check→install`,
  repeated retrieval of the same item, second-guessing before committing
- **coordination** — hand-offs/waiting: `carry→idle→install` across workers,
  `communicate→carry→install`, waiting gaps during multi-worker segments
- **attention** — deliberate verification: `check→risky`, `check→install`,
  inspection before a precision or dangerous action
- **smoothness** — timing disruptions: segments under 5 s (micro-stops),
  high duration variance within a sequence, erratic start-stop pacing

Leave `implicitIntents: []` if no genuine signal is present. Do NOT force-fit.

**C. Features**
For each detected intent instance, compute named numeric features. Examples:

- hesitation: `toolSwitchCount`, `reworkCount`, `pauseBeforeResumeSec`
- coordination: `handoffGapSec`, `waitTimeSec`, `communicationCount`
- attention: `verificationCount`, `checkToActRatioSec`, `missedCheckCount`
- smoothness: `microStopCount`, `shortSegmentCount`, `durationVarianceSec`

**D. Spatial intelligence extraction**
For each detected intent instance, extract a clip and run Gemini spatial analysis:

```bash
./ee video-clip data/<videoName> --start <intentStartSec> --end <intentEndSec>
./ee video-analyze <clip.mp4> "<spatial-prompt from above>" --schema '<spatial-schema from above>'
```

Parse the result into the `spatialIntelligence` block. If Gemini cannot determine a
dimension from the clip, omit that key — never fabricate spatial data.

**E. Score + reasoning**
Score each instance 0–100 (100 = expert, fluent; 0 = very poor). Write **3 or more**
plain-English sentences that integrate both behavioral and spatial observations:
- Sentence 1: what the task-type sequence tells you (behavioral implicit intent)
- Sentence 2: what the body / distance / trajectory data adds (spatial intelligence)
- Sentence 3+: combined interpretation — what skill level this implies, what the
  worker should do differently, or why the behavior makes sense given the context

**Do not write generic spatial filler.** Every spatial sentence must cite a specific
observation from the `spatialIntelligence` block (e.g. "approached to within 0.2m",
"pivoted 90° to face the joint", "took a 0.61-efficiency search path").

### Step 4 — Build and write the output JSON

Derive the filename from the video name (strip extension, add `.json`):

```
echo '<json>' | ./ee index-write behavioral entries/<videoName>.json
```

Output format:

```json
{
  "videoId": "<hash>",
  "videoName": "<source.name from timeline>",
  "generatedAt": "<ISO timestamp>",
  "segments": [
    {
      "segmentIndex": 0,
      "startSec": 0,
      "endSec": 45,
      "activity": "...",
      "taskTypeSequence": ["navigate", "carry"],
      "implicitIntents": []
    },
    {
      "segmentIndex": 3,
      "startSec": 135,
      "endSec": 185,
      "activity": "...",
      "taskTypeSequence": ["carry", "check", "carry", "install"],
      "implicitIntents": [
        {
          "category": "hesitation",
          "taskSet": ["carry", "check", "carry"],
          "startSec": 140,
          "endSec": 168,
          "features": { "reworkCount": 1, "pauseBeforeResumeSec": 12 },
          "score": 55,
          "reasoning": "Worker retrieved the fitting, paused to re-inspect alignment, then retrieved it again — the carry→check→carry sequence signals uncertainty about which component to use before committing to the press. Spatially, the worker approached to within 0.3m for the inspection but then stepped back ~0.6m before re-retrieving, adding unnecessary movement and reset time. A more experienced worker would verify component selection before leaving the staging area, eliminating the double-retrieval entirely.",
          "spatialIntelligence": {
            "bodyOrientation": {
              "label": "lean_in_for_precision",
              "observation": "Worker bent torso forward to within ~0.2m of the fitting during the mid-sequence inspection check."
            },
            "distanceBeforeAction": {
              "label": "reposition_until_comfortable",
              "estimatedMeters": 0.3,
              "observation": "Worker made two stance adjustments before committing to the press, closing to ~0.3m from the fitting on final approach."
            },
            "trajectoryEfficiency": {
              "label": "backtrack_detected",
              "efficiencyRatio": 0.52,
              "observation": "Worker moved toward the staging area, reversed back to the joint, then returned to staging — total path was nearly twice the direct distance."
            }
          }
        }
      ]
    }
  ]
}
```

### Step 5 — Update the task vocab

After processing all videos, write the (possibly extended) vocab back:

```
Write data/index/behavioral/task-vocab.json
```

### Tips

- Process videos one at a time, keeping the vocab updated between each.
- You can do a subset: "analyze the masonry videos only" is valid.
- To re-analyze a single video, just overwrite that entry file.

---

## Schema-Driven Scoring

Each index can declare a `"scoring"` key in its `schema.json` to enable
domain-aware ranking. When searching or dumping, results are sorted by a blend
of text relevance and domain score. Examples:

- `safety`: ranked by `severity` (1-10)
- `productivity`: ranked by `impact` (Low/Medium/High)
- `behavioral`: ranked by `overallScore` (0-100)
- `construction`: no scoring (text-only ranking)

## Workflow

1. **Read the schema** before writing to any index: `./ee index-read <index> schema.json`
2. **Search indices** to find relevant moments: `./ee index-read <index> --search "<query>"`
3. **Extract clips and frames** for your own analysis — these are silent and won't
   clutter the user's chat:
   - `./ee video-clip data/videos/<file> --start <sec> --end <sec>`
   - `./ee video-frame data/videos/<file> <seconds>`
4. **Analyze** with Gemini: `./ee video-analyze data/tmp/clips/<clip>.mp4 "<prompt>"`
5. **Present results** when you're ready: `./ee present <path>`
   Only show the user the final, curated media — not every intermediate frame.
6. **Update index data** if something is wrong: read → modify → write back via `index-write`

## Verifying Bounding Boxes

To verify that a bounding box is accurate, use `video-frame` to render it onto
a still frame, then send that annotated frame back to Gemini with `video-analyze`:

1. Extract the frame with the box drawn on it:
   `./ee video-frame data/videos/<file> <seconds> --region x,y,w,h`
2. Read the resulting JPEG to check it visually yourself.
3. To have Gemini confirm, send the annotated frame (or a short clip around that
   timestamp) back through `video-analyze` and ask whether the box correctly
   highlights the described activity or hazard.

This lets you close the loop — the agent generates a bounding box, renders it
onto the video frame, and then verifies it actually highlights the right thing.

## Tutorial Creation

**CRITICAL: Follow every step below when creating a tutorial. Do NOT skip any step.**

### Writing Style

**The reasoning field is the script.** Every narrate card must come from an `implicitIntent`
`reasoning` in the behavioral index — not from your own summary, not from the `activity` field,
not invented. If you find yourself writing narration that doesn't trace back to a specific
reasoning string, stop and go back to the index.

**Translate reasoning into two cards per behavioral moment:**
- Card 1: what this worker did and why it hurts (from the reasoning's problem clause)
- Card 2: what an expert does instead (from the reasoning's implication — make it explicit)

**Be literal.** Name the action, the object, the consequence. No metaphors.

- **Bad:** "He hesitates before placing the block."
- **Good:** "He stops mid-placement to re-check alignment. That uncertainty slows the whole lay cycle."

**The expert contrast is mandatory.** Every behavioral moment shown must be followed by a
narrate card explaining what an experienced tradesperson does differently and why. This is
the point of the tutorial — not just showing what went wrong, but teaching what right looks like.

- **Bad:** shows the hesitation clip, then takeaway "Don't hesitate."
- **Good:** shows the clip, then narrate "An expert sequences the block around the rebar before lifting — the move is planned before it starts, so there's no stop."

**Write for a person, not a document.** Say "he can't find his tape measure," not "suboptimal
tool-retrieval workflow." Each sentence should earn its place.

### Duration Limit

Tutorials MUST be **40 seconds or less** total. The renderer and validator will
both reject tutorials that exceed this limit. Budget your steps carefully:

- **narrate/takeaway**: `min(8, max(2, ceil(text.length / 20)))` seconds
- **play**: `endSec - startSec` (capped at 40s per clip)
- **pause**: `min(4, max(2, ceil(description.length / 30)))` seconds — **pauses are short by default (2–4s)**

Before writing `config.json`, mentally add up the durations. A 40-second video
typically has 4–7 steps. Keep narration direct. Keep play clips to 3–8 seconds
each. Keep pause descriptions to one sentence — pauses are meant to point at
something specific, not to linger.

### Step-by-Step Workflow

1. **Read behavioral entries — the reasoning IS the script**

   Do not write narration from scratch. Do not invent commentary. The `reasoning`
   field on every `implicitIntent` is the tutorial text — it was written to explain
   exactly what happened and what it means about skill level.

   Read the behavioral entry files for the relevant videos:
   ```
   ./ee index-read behavioral entries/<video>.json
   ```
   Or search by category:
   ```
   ./ee index-read behavioral --search "hesitation"
   ./ee index-read behavioral --search "attention"
   ./ee index-read behavioral --search "coordination"
   ./ee index-read behavioral --search "smoothness"
   ```

   Read every `reasoning` field you find. Each one tells a complete story:
   - **Low score (< 65)**: describes what went wrong and why it hurts. Use it to explain the mistake and its cost.
   - **High score (≥ 80)**: describes what expertise looks like and why it works. Use it to show the right behavior.

   **Structure each behavioral moment as three steps:**

   **Narrate** — what this worker did wrong, drawn directly from the reasoning's first clause.
   State the behavior and why it's a problem.

   **Play** — the clip at `intent.startSec` / `intent.endSec`. This shows the viewer exactly
   what was described. No timestamps other than these — never guess.

   **Narrate** — what an expert does instead. This comes from the implication in the reasoning.
   Every low-score reasoning contains this contrast — read it carefully and make it explicit.

   **Example** — hesitation intent (score: 60), reasoning:
   > "Worker paused to re-check block cell alignment before threading over tall rebar — slight
   > struggle suggests uncertainty in sequencing the block around the steel, slowing the lay cycle."

   Maps directly to:
   ```json
   { "type": "narrate", "text": "He stops mid-placement to re-check alignment. That uncertainty slows the whole lay cycle." },
   { "type": "play", "video": "01_production_masonry.mp4", "startSec": 362, "endSec": 370, "label": "Hesitation at rebar", "description": "Worker pausing to re-check block cell alignment before threading over rebar." },
   { "type": "narrate", "text": "An expert sequences the block around the rebar before lifting it. The move is planned before it starts — no stop needed." }
   ```

   Then a single `takeaway` at the end — one concrete action the viewer can do tomorrow.

   Verify every clip before writing the config:
   ```
   ./ee video-clip data/videos/<video> --start <intent.startSec> --end <intent.endSec>
   ./ee video-analyze <clip-path> "Does this clip show: <reasoning>? Answer yes or no."
   ```
   If no, try the parent segment boundaries or pick a different intent.

2. **Draft config.json** — Write the tutorial script. Calculate the total
   duration before saving. If it exceeds 40 seconds, cut steps or shorten text.

   Every `play` step MUST have a `description` field — the reasoning text this clip
   is meant to illustrate. Not rendered in the video, but used by the review agent.

   ```json
   {
     "type": "play",
     "video": "...",
     "startSec": 362,
     "endSec": 370,
     "label": "Hesitation at rebar",
     "description": "Worker pausing to re-check block cell alignment before threading over rebar — uncertainty in sequencing slows the lay cycle."
   }
   ```

3. **Run `bun check`** — This runs the tutorial validator. Fix any errors before
   proceeding. Do NOT skip this step.

4. **Render** — Run `./ee tutorial-render <slug>`. It will fail if the tutorial
   exceeds 20 seconds.

5. **Review the video against the script** — This is MANDATORY. Run:

   ```bash
   ./ee tutorial-review <slug>
   ```

   This reads `config.json` and `video.mp4` together and asks Gemini to verify
   every step. Returns structured JSON: `{ pass, steps: [{stepIndex, stepType, ok, issue}], summary }`.

   If `pass` is false or any step has `ok: false`, fix those steps in config.json,
   re-run `bun check`, re-render, and re-review. Do NOT present until `pass` is true.

6. **Verify every bounding box individually** — For each pause step with a
   `region`, extract the annotated frame and confirm the box is right:

   ```
   ./ee video-frame data/videos/<file> <seconds> --region x,y,w,h
   ./ee video-analyze <frame.jpg> "Does the red box highlight <what description says>? Is it accurate?"
   ```

   Fix → `bun check` → re-render → re-review if the box is wrong.

7. **Fix and re-render** — Update config.json, re-run `bun check`, re-render,
   and re-review from step 5. Do NOT present until the review is clean.

8. **Present** — ONLY after a clean review:
   `./ee present data/tutorials/<slug>/video.mp4`

**NEVER present a video without a clean review against the config.json.**

### Common Mistakes to Avoid

- Writing narration that doesn't come from a `reasoning` field in the behavioral index
- Omitting the expert contrast after showing a mistake — every bad behavior needs a "here's what an expert does instead"
- Writing too many steps and exceeding the 40-second limit
- Using long narration text (each sentence costs 2–8 seconds)
- Using creative metaphors that replace what's literally shown ("archaeological expedition" instead of "he's digging through a messy bin")
- Writing pause descriptions that don't say exactly what the bounding box is pointing at
- Guessing bounding box coordinates without verifying them on a frame
- Presenting the video immediately after rendering without reviewing it
- Forgetting to run `bun check` after modifying config.json
- Using jargon or formal language instead of plain, conversational words

## Self-Correction

Don't blindly trust index data. When you read an entry that seems off, verify it:

1. Pull the frame at that timestamp with `video-frame`.
2. Look at it — does it match the description?
3. If it has a bounding box, render it with `--region` and check it highlights
   the right thing.
4. If something is wrong, fix it: read the file, correct the entry, write it back.

The index is a living document. If you find errors while answering a question,
fix them on the spot. Don't just report the error — correct it so the next
query gets better data.
