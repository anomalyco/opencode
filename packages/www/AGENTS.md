# Website guide

## Structure

- This is a standard Astro website with a fully owned frontend.
- Only `base` in `astro.config.ts` should know the deployment subpath. Use `import.meta.env.BASE_URL` everywhere else.
- The documentation feature is self-contained under `src/docs/` and renders through the thin route in `src/pages/docs/`.
- Do not add a documentation frontend framework; this package owns the UI directly.
- Keep the installer route dynamic and `public/openapi.json` generated from `packages/protocol/openapi.json`.

## Local development

- Run `bun dev` from this package and use the local URL printed by Astro.

## Validation

- Run `bun typecheck`, `bun run check:generated`, and `bun run build` from this package after changes.
- Treat validation and build errors as blockers.
