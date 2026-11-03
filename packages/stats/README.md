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

## Public page caching

Stats HTML, JSON, and Markdown use a one-minute browser cache and a five-minute shared cache. Expired responses must revalidate instead of serving stale snapshots. The console `/data` proxy inherits this policy from the stats app.

Cloudflare must respect these origin headers. The live `Stats pages: respect short origin cache TTL` cache rule applies to `/data` and `/data/*` on `opencode.ai` and `stats.opencode.ai`: browser TTL respects origin, edge TTL uses cache-control headers and bypasses cache when absent, and serving stale content while updating is disabled. This dashboard-managed rule overrides the zone's four-hour browser-cache minimum; preserve it when changing Cloudflare configuration. Purge both stats URL prefixes after changing the policy to clear existing cached responses.
