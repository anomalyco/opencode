# Share

The retired session-sharing host. `opncd.ai` (production) and `dev.opncd.ai` (development) serve the
"Session sharing has been discontinued" page, and the old `/api/share` endpoints still answer so V1
clients keep working.

`cloudflare.config.ts` defines the Worker. `deploy:dev` and `deploy:production` deploy it with `cf`,
after the SST job in `.github/workflows/deploy.yml`, because the SST stack owned this hostname until
the Worker moved here.

| Environment | Worker                      | URL                    |
| ----------- | --------------------------- | ---------------------- |
| Development | `opencode-share-dev`        | `https://dev.opncd.ai` |
| Production  | `opencode-share-production` | `https://opncd.ai`     |

```bash
bun run typecheck
bun run deploy:dev
bun run deploy:production
```
