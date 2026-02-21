# AGENTS.md

This file provides guidance to AI coding agents when working with code in this repository.

## Project Overview

Experience Engine is an AI-powered system that analyzes construction job site video to identify expert worker behaviors. It builds searchable behavioral timelines from video footage and provides an AI agent interface for querying patterns across datasets.

**Hackathon context:** UMD x Ironsite Startup Shell Hackathon (Feb 20-22, 2025). Theme: Spatial Intelligence in the Physical World.

## Monorepo Structure

- **`apps/api`** — Bun + Hono API server (port 7892). Provides the `/api/chat` streaming endpoint backed by Claude Code via Vercel AI SDK.
- **`apps/cli`** — Bun-based CLI tool (`ee` command) for video processing and index querying. Uses Vercel AI SDK + Google Gemini for video analysis.
- **`apps/web`** — Astro 5 + React 19 web interface (port 7891) with Tailwind CSS 4 and shadcn/ui (New York style, neutral base).
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

# Individual apps
cd apps/web && bunx astro dev    # Web app (port 7891)
cd apps/api && bun run dev       # API server (port 7892)

# Run a single workspace task
bunx turbo dev --filter=@experience-engine/web
bunx turbo build --filter=@experience-engine/cli
```

For the `ee` CLI commands (query, process, list, status), use the **`ee` skill**.

## Architecture

### API (`apps/api`)

Runs on **Bun** with **Hono** framework. Single-file server at `src/index.ts`, port **7892**.

Routes:

- `POST /api/chat` — Streaming chat endpoint. Accepts `{ messages }`, uses `claudeCode("sonnet")` via `ai-sdk-provider-claude-code`, returns streaming UI response.
- `GET /api/health` — Health check.

CORS allows `http://localhost:7891` (web app) on POST to `/api/*`.

### CLI (`apps/cli`)

Runs on **Bun** (not Node). Entry point: `src/index.ts` with command dispatch pattern. CLI usage is documented in the **`ee` skill** (`.claude/skills/ee/SKILL.md`) — use that skill for querying and managing video indices instead of duplicating CLI docs here.

Data model: Each index has a `manifest.json` tracking video files and their processing status (pending/done/error). Behavioral timelines are stored as `timelines/<sha1>.timeline.json`.

### Web (`apps/web`)

Astro static site with React islands. Path alias `@/*` maps to `src/*`. Dev server on port **7891**.

Key layers:

- `src/pages/` — Astro pages (file-based routing)
- `src/layouts/Layout.astro` — Base HTML wrapper
- `src/components/Chat.tsx` — Main chat UI using `useChat` from `@ai-sdk/react`, pointed at the API server. Renders streaming markdown via `streamdown`.
- `src/components/ui/` — shadcn/ui components
- `src/lib/utils.ts` — `cn()` helper (clsx + tailwind-merge)
- `src/styles/global.css` — Theme variables (OKLCH color space, dark mode support, custom `--color-ee-*` CSS variables)

## Agent Rules

- **Always run `bun check` after writing code.** Never skip this step — run it after every code change before considering the task done.
- **Never disable the chat input field.** The input should always remain enabled, even during message streaming/sending.

## Code Style

- **Prettier**: double quotes, semicolons, trailing commas, 2-space indent
- **ESLint**: TypeScript-ESLint recommended + Astro plugin + React Hooks rules
- **TypeScript**: strict mode (Astro strict config in web app)
- Astro files use the `astro` parser via prettier-plugin-astro
- Tailwind classes are auto-sorted via prettier-plugin-tailwindcss

## Key Dependencies

- **Turbo** for monorepo task orchestration (Bun workspaces)
- **Hono** for API server
- **Vercel AI SDK** (`ai`, `@ai-sdk/react`) for LLM integration and chat UI
- **ai-sdk-provider-claude-code** for Claude Code model access in the API
- **@ai-sdk/google** for Gemini video analysis in CLI
- **Streamdown** (`streamdown`, `@streamdown/code`) for streaming markdown rendering
- **Radix UI** primitives via shadcn/ui in web app
- **Lucide React** for icons
