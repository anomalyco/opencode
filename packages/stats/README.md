# OpenCode Stats

Stats is a separate site from the console. Runtime, database, and domain services live in `core`; the SolidStart website lives in `app`; deployable Lambda entrypoints live in `function`.

## Packages

- `app`: SolidStart frontend/site.
- `core`: Effect services, app config, Drizzle schema/migrations, and stats domains.
- `function`: Lambda handlers that call into `core` services.

## Commands

- `bun run dev:stats` from the repo root starts the SolidStart app.
- `bun run --cwd packages/stats/app typecheck` typechecks the site.
- `bun run --cwd packages/stats/core typecheck` typechecks the Effect/database package.
- `bun run --cwd packages/stats/function typecheck` typechecks Lambda entrypoints.
