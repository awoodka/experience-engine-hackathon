---
name: ee
description: Query and manage Experience Engine video behavioral indices. Use when the user asks about worker behavior, activities, expertise, inefficiencies, safety, tools, or anything related to construction site video analysis.
allowed-tools: Bash(./ee *)
---

# Experience Engine CLI

Use the `./ee` CLI to search behavioral timelines and compute heuristic expertise scores from construction site videos.

## Commands

### List indices

```bash
./ee list
```

### Query timelines

```bash
./ee query "<search terms>" [--index <name>] [--limit <n>]
```

Search across: activities, workers, tools, materials, spatial context, safety notes, risk levels, expertise signals, inefficiency signals, communication events, ergonomic notes.

### Score videos (behavioral heuristics)

```bash
./ee score [--index <name>] [--output <path>] [--limit <n>]
```

Computes quantitative expertise scores per video. Use when the user asks about:

- What inexperienced workers should learn
- Expert vs novice behavior
- Implicit intent (checking before acting, hesitation, coordination, smoothness)
- How to improve as a worker
- Which videos/clips show best practices
- Quantitative comparison across footage

**Output:** JSON with per-video `scores` (0–100) and `features` (raw metrics). Writes to stdout unless `--output` is given. Stderr shows progress; parse stdout for JSON.

**Example:**

```bash
./ee score --index construction --limit 5
```

### Check status

```bash
./ee status [--index <name>]
```

### Process videos

```bash
./ee process [--index <name>] [--force] [--limit <n>]
```

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

## Workflow for "teach me" or "what should I learn" questions

1. Run `./ee list` to see available indices.
2. Run `./ee score --index <name>` to get scores for all processed videos. Parse the JSON from stdout.
3. Optionally run `./ee query "<terms>" --index <name>` for qualitative segments (e.g. "expertise signals", "check before", "handoff").
4. Synthesize: cite high-scoring videos, explain which dimensions matter, give concrete behaviors and targets, and link to example timestamps from query hits.

## Rules

- **Never assume the schema of manifest or timeline files.** Before constructing commands or scripts that reference fields in `data/.ee/indices/*/manifest.json` or timeline JSON files, always read the file first to inspect the actual field names. Do not guess key names.

## General workflow

1. Run `./ee list` to see available indices.
2. For qualitative search: run `./ee query "<terms>"` for segments.
3. For quantitative analysis or teaching: run `./ee score` for heuristic scores and features.
4. Present findings with video names, timestamps, scores, and actionable guidance.

If no indices exist, tell the user to add videos to `data/` and run `./ee process`.
