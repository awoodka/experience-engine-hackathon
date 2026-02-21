---
name: ee
description: Query and manage Experience Engine video behavioral indices. Use when the user asks about worker behavior, activities, expertise, inefficiencies, safety, tools, or anything related to construction site video analysis.
allowed-tools: Bash(./ee *), Read, Write
---

# Experience Engine CLI

Use the `./ee` CLI to search behavioral timelines and compute heuristic expertise scores from construction site videos.

## Commands

- `./ee list` — show available indices
- `./ee query "<terms>" [--index <name>] [--limit <n>]` — search segments
- `./ee status [--index <name>]` — show processing progress
- `./ee process [--index <name>] [--force] [--limit <n>]` — build index
- `./ee tutorial render <id>` — render `data/tutorials/scripts/<id>.json` → MP4

**Rule:** Never assume timeline or manifest field names. Read the file first.

## Score output schema

Each video in the output has:

### `scores` (0–100, higher = more expert-like)

| Score | Meaning |
|-------|---------|
| `hesitationScore` | Fewer delays, reversals, excessive tool switching before committing |
| `coordinationScore` | Better timing between workers (quick handoffs, less wait-on-other) |
| `attentionScore` | More check-before-act (inspect/measure/verify before risky tasks) |
| `smoothnessScore` | Steadier execution, fewer micro-stops and choppy segments |
| `overallScore` | Average of the four dimension scores |

### `features` (raw metrics used to compute scores)

| Feature | Meaning | Expert-like |
|---------|---------|-------------|
| `medianGapSec` | Median idle time between consecutive tasks (sec) | Lower (e.g. ~5s) |
| `toolSwitchesPerMin` | Tool switches per minute | Lower (e.g. ~2) |
| `reworkCount` | Start→stop→restart same task within 30s | Lower |
| `handoffLatencySec` | Time from carry end to install start (sec) | Lower |
| `handoffCount` | Number of carry→install handoffs detected | Depends on task |
| `waitTimeSec` | Idle time during multi-worker segments | Lower |
| `checkBeforeActRate` | P(risky task has check within 10s before) 0–1 | Higher (e.g. 0.85+) |
| `missedCheckCount` | Risky tasks without preceding check | Lower |
| `verificationDiversity` | Distinct check-type activities | Higher |
| `segmentDurationCv` | Coefficient of variation of segment lengths | Lower |
| `microStopCount` | Very short segments (<5s) | Lower |

## How to use scores for teaching inexperienced workers

1. **Identify high-scoring videos** — Sort by `overallScore` or a specific dimension (e.g. `attentionScore`) to find exemplar clips.
2. **Translate scores into behaviors** — Map scores to implicit intent:
   - **Attention** → "Check before acting: inspect, measure, or verify before cutting, drilling, lifting, or pressing."
   - **Hesitation** → "Reduce gaps between tasks and avoid switching tools frequently."
   - **Coordination** → "Align handoffs with partners; minimize wait time."
   - **Smoothness** → "Work in longer, steadier segments instead of stop-start bursts."
3. **Give actionable targets** — e.g. "Aim for check-before-act rate ≥ 0.8; experts in this footage average 0.85."
4. **Combine with `ee query`** — Use scores to rank/select videos, then `ee query "inspect before"` or `ee query "handoff"` to find timestamped segments that illustrate those behaviors.

## General workflow

1. `./ee list` to see indices
2. `./ee query "<terms>"` to find relevant segments
3. `./ee score` for quantitative expertise scores and teaching guidance
4. Present findings with video names, timestamps, scores, and actionable guidance

If no indices exist, tell the user to add videos to `data/` and run `./ee process`.

---

## Tutorial authoring

When the user asks for a tutorial, the goal is to identify what separates the most experienced workers from the least, then teach those specific behaviors. Never invent timestamps — always source them from query results or timeline files.

**1. Score all videos:** `./ee score` — rank by `overallScore`. Identify the top scorer(s) (most experienced) and bottom scorer(s) (least experienced).

**2. Analyze the gap:** Compare scores and features between top and bottom. Find the dimensions with the largest spread (e.g. expert `attentionScore: 88`, novice `attentionScore: 32`). Those gaps define what the tutorial teaches. Reason explicitly: "The biggest difference is X, driven by feature Y."

**3. Find expert clips:** `./ee query "<behavior from gap>" --limit 15` searching only within the top-scoring video(s). Note video filename, startSec, endSec. Get exact timestamps if needed by reading `data/.ee/indices/default/timelines/<file>.timeline.json`.

**4. Write** `data/tutorials/scripts/<id>.json` — structure the tutorial as: introduce the expert/novice gap → show expert behavior with clips → highlight what to look for with pause steps → close with an actionable takeaway tied to a specific feature target (e.g. "aim for checkBeforeActRate ≥ 0.8"):

```json
{
  "title": "Short title",
  "type": "tutorial",
  "description": "One sentence describing what this teaches.",
  "trade": "<inferred from footage: Masonry, Carpentry, Plumbing, Electrical, etc.>",
  "skill": "<specific skill: Mortar Application, Pipe Threading, etc.>",
  "generatedAt": "<ISO timestamp>",
  "steps": [
    { "type": "narrate", "text": "Intro text." },
    {
      "type": "play",
      "video": "filename.mp4",
      "startSec": 39,
      "endSec": 47,
      "label": "Optional caption"
    },
    {
      "type": "pause",
      "video": "filename.mp4",
      "timestampSec": 43,
      "description": "What to notice.",
      "region": { "x": 0.36, "y": 0.44, "w": 0.23, "h": 0.15 }
    },
    { "type": "takeaway", "text": "Key lesson." }
  ]
}
```

**Step types:**

- `narrate` — white text card, 6s. Required: `text`
- `play` — footage clip. Required: `video`, `startSec`, `endSec` (endSec > startSec, 5–45s). Optional: `label`
- `pause` — freeze frame, 5s. Required: `video`, `timestampSec`, `description`. Optional: `region` (amber box, values 0–1)
- `takeaway` — amber text card, 7s. Required: `text`

**5. Render:** `./ee tutorial render <id>`
