---
name: ee
description: Query and manage Experience Engine video behavioral indices. Use when the user asks about worker behavior, activities, expertise, inefficiencies, safety, tools, or anything related to construction site video analysis.
allowed-tools: Bash(./ee *)
---

# Experience Engine CLI

Use the `./ee` CLI to search behavioral timelines extracted from construction site videos.

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

### Check status

```bash
./ee status [--index <name>]
```

### Process videos

```bash
./ee process [--index <name>] [--force] [--limit <n>]
```

## Workflow

1. Run `./ee list` to see available indices
2. Run `./ee query` to search for relevant segments
3. Present findings with video names, timestamps, and details

If no indices exist, tell the user to add videos to `data/` and run `./ee process`.
