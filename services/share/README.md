# Share (deprecated)

> **Deprecated.** Session sharing was retired in #55716 and V2 has no sharing. Don't add features here.
> This Worker only exists so old share links and V1 clients get a clear "discontinued" answer, and it
> can be deleted whenever we're fine breaking those.

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
