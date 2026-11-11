# Pinned deploy targets

These files are the allow-list for the deploy jobs that hold a Cloudflare
token. `deploy-*.sh` refuses an artifact whose resolved config is not exactly
one of these files, then deploys the pinned config (never the artifact's copy).

The deploy token can write every Worker on the account (the data sync Workflow
needs account-wide `Workers Scripts Write`; Cloudflare has no per-Worker
Workflows permission), so changing what a stage can deploy means changing these
files, which CODEOWNERS (`/.github/ @thdxr`) reviews.

- `site/`, `legacy/`, `data/`: expected `v0/config.json` and
  `v0/workers/<dir>/worker.config.json` from the `cf` Build Output artifact.
- `files/`, `update/`: the complete `wrangler.json` the deploy script passes to
  the pinned wrangler CLI. The artifact is only the bundled `index.js`; these
  services have no config in the artifact to trust.

A Worker's own code and assets are expected to change freely. Names, routes,
custom domains, crons, Workflow/export names, and every binding (including
service bindings to other Workers) are pinned here.
