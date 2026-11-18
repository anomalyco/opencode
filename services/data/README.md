# Data

Deploys the opencode.ai/data site from `packages/data` as three Workers with `cf`:

| Worker                       | Config                 | What it is                                                                    |
| ---------------------------- | ---------------------- | ----------------------------------------------------------------------------- |
| `opencode-data-<stage>`      | `cloudflare.config.ts` | The SolidStart site, on `/data*` and `/<locale>/data*` of the stage's host    |
| `opencode-data-og-<stage>`   | `og.config.ts`         | Open Graph images, reached only through the site's `OG_WORKER` binding        |
| `opencode-data-sync-<stage>` | `sync.config.ts`       | The `opencode-data-sync-<stage>` Workflow and the cron handler that starts it |

`script/build.ts` builds all three into one Build Output tree and `script/deploy.ts` deploys them with
`cf deploy --prebuilt`, the OG Worker first. The `data` job in `.github/workflows/deploy.yml` runs
`deploy:dev` or `deploy:production` and passes the Worker secrets from AWS Secrets Manager
(`opencode/<stage>/DATA_DATABASE_HOST`, `DATA_DATABASE_USERNAME`, `DATA_DATABASE_PASSWORD`,
`R2_SQL_AUTH_TOKEN`, `DATA_HIDDEN_MODELS`) with `--secrets-file`. Each Worker gets only the secrets
its config declares.

The database is the `opencode-stats` PlanetScale database: the `dev` branch for dev and `production`
for production, through the `data-worker-<stage>` password. It is not managed as code.

Every config, `script/build.ts` and `script/deploy.ts` take the stage from `--mode`, which must be `dev` or
`production` (`stage.ts`). Anything else, including no mode, throws instead of falling back to production, so pass
`--mode` to `cf` commands that read the configs too (`cf deploy --dry-run --mode dev`).

```bash
bun run dev               # the site on your machine (packages/data/app)
bun run build:dev         # or build:production
bun run typecheck
```
