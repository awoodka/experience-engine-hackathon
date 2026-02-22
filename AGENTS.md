# Repository Guidelines

## Structure

Bun + Turborepo monorepo.

- `apps/api`: Hono API for chat streaming (port 7892).
- `apps/cli`: `ee` CLI — video analysis, indexing, search, tutorial rendering.
- `apps/web`: Astro + React frontend (port 7891, proxies `/api` → 7892).
- `data/videos/`: source video files.
- `data/index/`: behavioral indices. Each index has `schema.json` and `entries/<video>.json`.
- `data/tutorials/`: per-tutorial dirs — `config.json`, `video.mp4`, `thumb.jpg`, `meta.json`.

## Commands

- `bun install` — install dependencies.
- `bun run dev` — run all dev servers.
- `bun run build` — build all workspaces.
- `bun run check` — format + lint + validate tutorials and indices. **Run after every code change.**
- `./ee --help` — CLI command reference.
- `bun run data-pull` / `bun run data-push` — sync `data/` via gh CLI.

## Code Style

TypeScript (ESM, strict). Prettier: tabWidth 2, semicolons, double quotes, trailing commas. ESLint with TypeScript, Astro, React Hooks rules.

React components: `PascalCase`. Utilities: `camelCase`. CLI commands: `kebab-case`.

## Commits

Concise imperative subjects: `Add ...`, `Fix ...`, `Refactor ...`. Keep commits scoped.

## Environment

Do not commit `.env*`. CLI requires `GOOGLE_GENERATIVE_AI_API_KEY` and `EE_GEMINI_MODEL`.
