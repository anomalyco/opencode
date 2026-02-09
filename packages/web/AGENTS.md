# WEB KNOWLEDGE BASE

## OVERVIEW

Astro/Starlight docs + landing site; content-driven package with shared model/session rendering.

## WHERE TO LOOK

- Docs content: `packages/web/src/content/docs`
- Share/render components: `packages/web/src/components/share`
- Build config/scripts: `packages/web/package.json`, `packages/web/astro.config.mjs`
- Static assets: `packages/web/src/assets`, `packages/web/public`

## CONVENTIONS

- Dev/build/preview use Astro scripts in package.json.
- `dev:remote` sets `VITE_API_URL=https://api.opencode.ai`.
- Keep docs structure route-friendly (`index.mdx` and nested content folders).

## ANTI-PATTERNS

- Don’t rely on starter-template README defaults as project truth.
- Don’t mix generated/shared runtime data into docs content files.
- Don’t change docs route layout without checking linked nav/content config.
