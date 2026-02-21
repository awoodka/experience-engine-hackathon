# Repository Guidelines

## Project Structure & Module Organization

This repository is a Bun + Turborepo monorepo.

- `apps/api`: Hono API for chat streaming (`/api/chat`, health on port `7892`).
- `apps/cli`: `ee` CLI for video analysis, indexing, and search.
- `apps/web`: Astro + React frontend (dev server on `7891`, proxies `/api` to `7892`).
- `scripts/sync.ts`: team data sync/upload flow via secret GitHub Gist.
- `data/videos/`: source video files.
- `data/index/`: behavioral indices (queryable by `./ee` CLI). Each index has `entries/<video>.json`.
- `data/tutorials/`: agent-generated video tutorial scripts.
- `data/tmp/`: temporary files (extracted frames, etc.).
- `packages/`: reserved for shared packages (currently empty).

## Build, Test, and Development Commands

Run from repo root unless noted.

- `bun install`: install workspace dependencies.
- `bun run dev`: run all app dev servers through Turbo.
- `bun run build`: build all workspaces (`dist/`, `.astro/` outputs).
- `bun run check`: format + lint fix (`prettier --write` and `eslint --fix`).
- `bun run ee --help` or `./ee --help`: inspect CLI commands.
- `bun run sync` / `bun run upload`: pull/push `data/` with `gh` CLI.

## Coding Style & Naming Conventions

- Language: TypeScript (ESM, strict settings in app configs).
- Formatting: Prettier (`tabWidth: 2`, semicolons, double quotes, trailing commas).
- Linting: ESLint with TypeScript, Astro, and React Hooks rules.
- Naming: React components in `PascalCase` (`Chat.tsx`), utility/functions in `camelCase`, CLI command files in `kebab-case` (`video-analyze.ts`).
- Keep modules focused; place app-specific logic in each app’s `src/` directory.

## Testing Guidelines

There is no dedicated automated test suite yet (`test` script/framework is not configured). Minimum validation for changes:

- Run `bun run check` and `bun run build`.
- Smoke-test touched flows (CLI command path, API endpoint, or web UI interaction).
  When adding tests, colocate with source using `*.test.ts` / `*.test.tsx` naming.

## Commit & Pull Request Guidelines

Git history uses concise, imperative commit subjects (for example: `Add ...`, `Refactor ...`, `Update ...`). Follow that style and keep commits scoped.
For PRs, include:

- what changed and why,
- how to validate (commands run),
- linked issue/context,
- screenshots or short clips for `apps/web` UI changes,
- notes for env/data/schema impacts (especially `data/index` and `.env` usage).

## Security & Configuration Tips

- Do not commit secrets or local env files (`.env*` is ignored).
- CLI requires `GOOGLE_GENERATIVE_AI_API_KEY` and `EE_GEMINI_MODEL`.
- Treat `data/` as potentially large/sensitive; share index snapshots via the sync script, not ad hoc commits.
