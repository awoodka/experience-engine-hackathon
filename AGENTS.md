# AGENTS.md

This file provides guidance to AI coding agents when working with code in this repository.

## Project Overview

Experience Engine is an AI-powered system that analyzes construction job site video to identify expert worker behaviors. It builds searchable behavioral timelines from video footage and provides an AI agent interface for querying patterns across datasets.

**Hackathon context:** UMD x Ironsite Startup Shell Hackathon (Feb 20-22, 2025). Theme: Spatial Intelligence in the Physical World.

## Monorepo Structure

- **`apps/cli`** — Bun-based CLI tool (`ee` command) for video processing and index querying. Uses Vercel AI SDK.
- **`apps/web`** — Astro 5 + React 19 web interface with Tailwind CSS 4 and shadcn/ui (New York style, neutral base).
- **`packages/`** — Shared packages (currently empty).
- **`data/`** — Gitignored. Stores video files and behavioral indices at `data/.ee/indices/`.

## Commands

```bash
# Install dependencies
bun install

# Development (runs all apps in parallel via Turbo)
bun run dev

# Build all apps
bun run build

# Format, lint, and auto-fix
bun run check

# CLI directly (from repo root)
bun apps/cli/src/index.ts <command>
# Or direct wrapper:
./ee <command>
# Or from apps/cli:
bun run dev

# Web app only
cd apps/web && bunx astro dev

# Run a single workspace task
bunx turbo dev --filter=@experience-engine/web
bunx turbo build --filter=@experience-engine/cli
```

## Architecture

### CLI (`apps/cli`)

Runs on **Bun** (not Node). Entry point: `src/index.ts` with command dispatch pattern.

Commands:
- `process` — Build/resume a behavioral index from video files (TODO)
- `query` — Search an index for behavioral patterns (TODO)
- `list` — Show all indices in `data/.ee/indices/`
- `status` — Show processing progress for an index

Data model: Each index has a `manifest.json` tracking video files and their processing status (pending/done/error). Behavioral timelines are generated per-video.

### Web (`apps/web`)

Astro static site with React islands. Path alias `@/*` maps to `src/*`.

Key layers:
- `src/pages/` — Astro pages (file-based routing)
- `src/layouts/Layout.astro` — Base HTML wrapper
- `src/components/ui/` — shadcn/ui components
- `src/lib/utils.ts` — `cn()` helper (clsx + tailwind-merge)
- `src/styles/global.css` — Theme variables (OKLCH color space, dark mode support)

## Code Style

- **Prettier**: double quotes, semicolons, trailing commas, 2-space indent
- **ESLint**: TypeScript-ESLint recommended + Astro plugin + React Hooks rules
- **TypeScript**: strict mode (Astro strict config in web app)
- Astro files use the `astro` parser via prettier-plugin-astro
- Tailwind classes are auto-sorted via prettier-plugin-tailwindcss

## Key Dependencies

- **Turbo** for monorepo task orchestration (Bun workspaces)
- **Vercel AI SDK** (`ai` package) in CLI for LLM integration
- **Radix UI** primitives via shadcn/ui in web app
- **Lucide React** for icons
