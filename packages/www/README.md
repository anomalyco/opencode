# OpenCode website

The OpenCode V2 website, powered by Blume and deployed with Wrangler at `https://opencode.ai/v2/`. Blume mounts the documentation at `/v2/docs`, and `https://v2.opencode.ai` redirects to the same deployment.

Wrangler deploys the site through Blume's Cloudflare server adapter. Documentation pages are prerendered, while custom dynamic routes and endpoints can run in the Worker. Production uses `opencode-www` at `opencode.ai/v2/`; dev uses `opencode-www-dev` at `dev.opencode.ai/v2/`. The `v2.opencode.ai` alias is handled by a Cloudflare Redirect Rule outside this project.

The `deploy-www` GitHub workflow deploys the `dev` branch to the dev Worker and the `v2` branch to the production Worker.

## Development

From this directory, run:

```bash
bun dev
```

The site opens at `http://localhost:3000/v2/`; documentation is available at `http://localhost:3000/v2/docs`.

## Verification

```bash
bun typecheck
bun validate
bun run build
```
