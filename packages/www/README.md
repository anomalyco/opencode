# OpenCode website

The standard Astro website for OpenCode. The only deployment-specific path is the `base` setting in `astro.config.ts`; application code uses `import.meta.env.BASE_URL`.

- `src/pages/` owns website routes.
- `src/docs/` is the self-contained documentation feature rendered under `/docs`.
- `/install` proxies the current installer.
- `/openapi.json` serves the generated OpenAPI specification.

The deployment currently sets `base: "/v2"`. The `v2.opencode.ai` alias is handled by a Cloudflare Redirect Rule outside this project.

## Development

From this directory, run:

```bash
bun dev
```

The local URL includes the base configured in `astro.config.ts`.

## Verification

```bash
bun typecheck
bun run check:generated
bun run build
```
