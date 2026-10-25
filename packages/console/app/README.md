# Console App

The opencode.ai website: marketing pages, docs, downloads, Zen, enterprise, and the `/data` stats proxy. It is a SolidStart app built with Vite and Nitro's `cloudflare-module` preset.

## Commands

Run these from `packages/console/app`:

- `bun dev` starts the site on port 3001.
- `bun dev:remote` starts it inside `sst shell --stage=dev`, so it can reach dev-stage resources.
- `bun dev:enterprise` runs a local `/api/enterprise` handler that submits leads through the Salesforce CLI (`sf`) for the org in `SF_TARGET_ORG` (default `opencode`).
- `bun run build` generates the sitemap, builds the site, and writes the config JSON schema to `.output/public/config.json`.
- `bun typecheck` and `bun test` check the package.
