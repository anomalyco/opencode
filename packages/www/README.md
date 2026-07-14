# OpenCode website

The server-rendered `opencode.ai` website. It uses TanStack Start on Cloudflare Workers and serves the V2 documentation with Fumadocs.

## Development

From this directory, run:

```bash
bun dev
```

The site opens at `http://localhost:3000`; documentation is available at `http://localhost:3000/docs`.

## Verification

```bash
bun typecheck
bun run build
```

The existing `packages/web`, `packages/docs`, and `packages/stats/app` deployments remain in place until their routes have been migrated and verified.
