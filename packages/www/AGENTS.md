# Website and documentation guide

## Structure

- This package owns the `opencode.ai` website.
- Add custom marketing routes as Astro files under `pages/`.
- The whole project is mounted at `/v2/` by `deployment.base`, and documentation lives under `content/docs/` at `/v2/docs` through `basePath` in `blume.config.ts`.
- Write documentation in MDX. Every page should have `title` and `description` frontmatter.
- Use parenthesized content folders for sidebar groups that must not add a URL segment. Keep ungrouped top-level pages directly under `content/docs/`.
- Put static files in `public/` and reference them with root-relative paths.
- The API reference is generated from `openapi.json`; do not duplicate endpoint documentation as hand-written MDX.
- Keep documentation aligned with the current packages.

## Local development

- Run `bun dev` from this package and preview the site at `http://localhost:3000/v2/`.
- Verify both custom marketing routes and documentation routes after changing shared navigation or layout code.

## Validation

- Run `bun typecheck`, `bun validate`, and `bun run build` from this package after documentation or configuration changes.
- Treat validation and build errors as blockers.
