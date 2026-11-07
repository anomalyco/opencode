# OpenCode Stats

Stats is a separate site from the console. Runtime, database, and domain services live in `core`; the SolidStart website lives in `app`; the Cloudflare Workers that sync stats live in `server`.

## Packages

- `app`: SolidStart frontend/site.
- `core`: Effect services, app config, Drizzle schema/migrations, and stats domains.
- `server`: the `StatsSyncWorkflow` Workflow, the `StatsSyncCron` Worker that starts it, and a local sync script.

## Commands

- `bun run dev:stats` from the repo root starts the SolidStart app.
- `bun run --cwd packages/stats/app typecheck` typechecks the site.
- `bun run --cwd packages/stats/core typecheck` typechecks the Effect/database package.
- `bun run --cwd packages/stats/server typecheck` typechecks the sync Workers.

## Stats sync

The sync reads aggregates from R2 SQL and writes them to the stats PlanetScale database. It runs on the `dev` and `production` stages as a Cloudflare Workflow, `StatsSyncWorkflow`, defined in `infra/stats.ts`.

Each run has a `plan` step, then one step per stat period (`week 2026-W45`, `day 2026-11-03`) and one per retention cohort (`retention 2026-10-05`). The plan snapshots the model catalog once, so every step attributes models the same way. Steps run one at a time and retry twice with exponential backoff. A rejected query (HTTP 400, 401 or 403) or a result over the 10,000-row limit fails its step after one attempt, since a retry repeats the same R2 SQL spend. A failed step does not stop the others, but the run ends as errored and logs each failed step with its error. Because queries run per period, expect an hourly run to take about 15 to 25 minutes and a history run about 2 to 3.5 hours. These are estimates until measured on a deployed stage.

The `StatsSyncCron` Worker starts runs on two schedules:

- `5 * * * *`: an hourly run of the current ISO week and the most recent complete retention cohort, with instance ID `stats-hourly-YYYY-MM-DDTHH`.
- `20 3 * * *`: a daily history run of the rest of the 56-day display window, with instance ID `stats-history-YYYY-MM-DD`.

Times and IDs are in UTC. Before starting a run, the Cron checks this slot's ID and the recent IDs of the same kind: the five previous hours for an hourly run, the two previous days for a history run. It skips the run if any of them is queued, running, waiting or paused, or if this slot's instance already exists, and logs the reason. Hourly and history runs can overlap, since they cover different periods and their writes are idempotent.

To start a run by hand, find the Workflow's name with `bunx wrangler workflows list` (it is `opencode-<stage>-statssyncworkflowworkflow-<suffix>`), then trigger it with an ID from the Cron's convention so scheduled runs of the same kind see it and wait:

```sh
bunx wrangler workflows trigger <workflow-name> '{"history":true}' --id stats-history-2026-11-03
```

Omit `history` for an hourly run. If the ID already exists, that slot has run; wait for the next one. You can also trigger a run from the Workflow's page in the Cloudflare dashboard; without params it runs as an hourly pass.

To run one sync pass on your machine against a stage's resources, run `bun sst shell --stage=<stage> -- bun run --cwd packages/stats/server sync`, adding `--history` for a history pass. `sst dev` also offers it as the `StatsSync` command.

## Public page caching

Stats HTML, JSON, and Markdown use a one-minute browser cache and a five-minute shared cache. Expired responses must revalidate instead of serving stale snapshots.

The Worker has no custom domain. `infra/stats.ts` routes `/data*` and `/<locale>/data*` on the main host straight to it, so its responses skip the Cloudflare cache and reach browsers with these headers unchanged. Static assets are uploaded under `/data`, and the build moves Nitro's `_headers` to the assets root so they stay immutable.
