# Meta

Machine-readable files that clients fetch from fixed `opencode.ai` URLs. They are
not part of the website, so they live in their own Worker with one `<path>*` route
per path. The `*` lets requests with a query string through; anything that isn't
exactly one of the paths gets a 404.

| Path                                      | Source                                                                                  |
| ----------------------------------------- | --------------------------------------------------------------------------------------- |
| `/config.json`                            | `opencode.json` schema, generated at build by `packages/schema/script/config-schema.ts` |
| `/tui.json`                               | V1 TUI schema, static in `public/tui.json`                                              |
| `/oauth/opencode/client.json`             | MCP OAuth client metadata, built per request so `client_id` equals the fetched URL      |
| `/.well-known/apple-app-site-association` | iOS universal links for `/pair`                                                         |

| Environment | Worker                     | Host              |
| ----------- | -------------------------- | ----------------- |
| Development | `opencode-dev-meta`        | `dev.opencode.ai` |
| Production  | `opencode-production-meta` | `opencode.ai`     |

## Deployment

`cloudflare.config.ts` defines the Worker and its routes. `deploy-meta.yml` deploys
`dev` and `production` on pushes to those branches with the `cf` CLI:

```bash
bun run build --mode dev
bun run deploy --mode dev
```

The routes win over the website's Custom Domain as soon as they exist, so check a
new route against the live response before it ships.
