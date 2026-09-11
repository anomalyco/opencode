# Website guide

## Structure

- This is a standard Astro website with a fully owned frontend.
- Only `base` in `astro.config.ts` should know the deployment subpath. Use `import.meta.env.BASE_URL` everywhere else.
- The documentation feature is self-contained under `src/docs/` and renders through the thin route in `src/pages/docs/`.
- Do not add a documentation frontend framework; this package owns the UI directly.
- Keep the installer route dynamic and `public/openapi.json` generated from `packages/protocol/openapi.json`.

## Local development

- Run `bun dev` from this package and use the local URL printed by Astro.
- Do not run `bun typecheck`, `bun run build`, or another Astro process while the dev server is running. They share the Vite dependency cache and can break the active dev server. Leave validation to the user when the dev server is active.

## Validation

- Run `bun typecheck`, `bun run check:generated`, and `bun run build` from this package after changes.
- Treat validation and build errors as blockers.
