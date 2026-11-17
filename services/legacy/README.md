# Legacy (deprecated)

> **Deprecated.** What is left of V1's hosted services. Don't add features here. Each hostname can be
> dropped whenever we're fine breaking the old clients that still call it.

One Worker that answers by hostname:

- `opncd.ai` (production) and `dev.opncd.ai` (development) are the retired session-sharing host.
  Session sharing was retired in #55716 and V2 has no sharing. They serve the "Session sharing has
  been discontinued" page, and the old `/api/share` endpoints still answer so V1 clients keep working
  (`src/share.ts`).
- `api.opencode.ai` (production) exchanges a GitHub Actions
  OIDC token for a GitHub App installation token for the V1 GitHub Action
  (`POST /exchange_github_app_token`, `src/api.ts`). The dev endpoint returns 503.

`cloudflare.config.ts` defines the Worker. `deploy:dev` and `deploy:production` deploy it with `cf`
from `.github/workflows/deploy.yml`. The production deploy reads the `GITHUB_APP_ID` and `GITHUB_APP_PRIVATE_KEY` Worker
secrets from AWS Secrets Manager (`opencode/production/GITHUB_APP_*`) and uploads them with
`--secrets-file`.

| Environment | Worker                       | Hostnames                             |
| ----------- | ---------------------------- | ------------------------------------- |
| Development | `opencode-legacy-dev`        | `dev.opncd.ai`, `api.dev.opencode.ai` |
| Production  | `opencode-legacy-production` | `opncd.ai`, `api.opencode.ai`         |

```bash
bun run typecheck
bun test
```
