# opencode.ai

The opencode.ai website, deployed as one Cloudflare Worker with the `cf` CLI:

- `site/`: the site (David Hill's design): home, product pages, brand, press, legal, changelog and the 404, in 18 languages. SolidStart; see `site/README.md`, `site/DESIGN.md` and `site/MEDIA.md`.
- `src/`: the V2 docs under `/v2` (Astro). Only `base` in `astro.config.ts` knows the subpath; the docs feature is self-contained under `src/docs/`.
- `textjs/`: the font page's Text.js apps, built into `site/public/textjs/`.
- `worker.ts`: sends `/v2*` to the docs server and everything else to the site server.
- `cloudflare.config.ts`: the Worker, its bindings and its routes, for `--mode dev` (dev.opencode.ai) and production (opencode.ai).

## Development

```bash
bun dev        # the docs, on :3000
bun dev:site   # the site, on :3001 (heavy media is proxied from dev.opencode.ai/files)
```

## Build and deploy

```bash
bun run build -- --mode dev     # docs + site into .cloudflare/output (Build Output Specification)
bun run deploy:dev              # build, then cf deploy --prebuilt --mode dev
```

CI deploys on pushes to `dev` and `production` (`.github/workflows/deploy-www.yml`). Production keeps only its `/v2*` route until `productionOwnsRoot` in `cloudflare.config.ts` is switched on.

## Verification

```bash
bun typecheck
bun test
bun run build -- --mode dev
```
