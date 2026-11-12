# OpenCode Data

The data site (opencode.ai/data) is separate from the console. Runtime, database, and domain services live in `core`; the SolidStart website lives in `app`; the Cloudflare Workers that sync its data live in `server`.

## Packages

- `app`: SolidStart frontend/site.
- `core`: Effect services, app config, Drizzle schema/migrations, and the data domains.
- `server`: the `DataSyncWorkflow` Workflow, the cron handler that starts it, and a local sync script.

`services/data` builds and deploys them as the `opencode-data-<stage>`, `opencode-data-og-<stage>` and `opencode-data-sync-<stage>` Workers.

## Commands

- `bun run --cwd packages/data/app dev` starts the SolidStart app (see Data sync for its environment).
- `bun run --cwd packages/data/app typecheck` typechecks the site.
- `bun run --cwd packages/data/core typecheck` typechecks the Effect/database package.
- `bun run --cwd packages/data/server typecheck` typechecks the sync Workers.

## Data sync

The sync reads aggregates from R2 SQL and writes them to the `opencode-stats` PlanetScale database. It runs on the `dev` and `production` stages as a Cloudflare Workflow, `DataSyncWorkflow`, in the `opencode-data-sync-<stage>` Worker that `services/data` deploys.

Each run has a `plan` step, then one step per stat period (`week 2026-W45`, `day 2026-11-03`) and one per retention cohort (`retention 2026-10-05`). The plan snapshots the model catalog once, so every step attributes models the same way. Steps run one at a time and retry twice with exponential backoff. A rejected query (HTTP 400, 401 or 403) or a result over the 10,000-row limit fails its step after one attempt, since a retry repeats the same R2 SQL spend. A failed step does not stop the others, but the run ends as errored and logs each failed step with its error. Because queries run per period, expect an hourly run to take about 15 to 25 minutes and a history run about 2 to 3.5 hours. These are estimates until measured on a deployed stage.

The same Worker's cron handler starts runs on two schedules:

- `5 * * * *`: an hourly run of the current ISO week and the most recent complete retention cohort, with instance ID `data-hourly-YYYY-MM-DDTHH`.
- `20 3 * * *`: a daily history run of the rest of the 56-day display window, with instance ID `data-history-YYYY-MM-DD`.

Times and IDs are in UTC. Before starting a run, the cron handler checks this slot's ID and the recent IDs of the same kind: the five previous hours for an hourly run, the two previous days for a history run. It skips the run if any of them is queued, running, waiting or paused, or if this slot's instance already exists, and logs the reason. Hourly and history runs can overlap, since they cover different periods and their writes are idempotent.

To start a run by hand, trigger the `opencode-data-sync-<stage>` Workflow with an ID from the cron handler's convention so scheduled runs of the same kind see it and wait:

```sh
cf workflows instances create opencode-data-sync-dev --instance-id data-history-2026-11-03 --params '{"history":true}'
cf workflows instances get data-history-2026-11-03 --workflow-name opencode-data-sync-dev
```

Omit `history` for an hourly run. If the ID already exists, that slot has run; wait for the next one. You can also trigger a run from the Workflow's page in the Cloudflare dashboard; without params it runs as an hourly pass.

To run one sync pass on your machine against a stage's resources, export `STAGE`, `DATA_DATABASE_HOST`, `DATA_DATABASE_USERNAME`, `DATA_DATABASE_PASSWORD`, `R2_SQL_AUTH_TOKEN` and `DATA_HIDDEN_MODELS` (AWS Secrets Manager `opencode/<stage>/*`; `packages/data/core/src/resource.ts` reads them), then run `bun run --cwd packages/data/server sync`, adding `--history` for a history pass. `bun run --cwd packages/data/app dev` reads the same database variables.

## Public page caching

Data site HTML, JSON, and Markdown use a one-minute browser cache and a five-minute shared cache. Expired responses must revalidate instead of serving stale snapshots.

The Worker has no custom domain. `services/data/cloudflare.config.ts` routes `/data*` and `/<locale>/data*` on the main host straight to it, so its responses skip the Cloudflare cache and reach browsers with these headers unchanged. Static assets are uploaded under `/data`, and the build moves Nitro's `_headers` to the assets root so they stay immutable.
