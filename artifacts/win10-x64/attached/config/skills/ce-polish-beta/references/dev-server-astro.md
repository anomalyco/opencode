# Astro dev-server recipe (auto-detect fallback)

Loaded when `detect-project-type.sh` returns `astro` and there is no `.opencode/launch.json` to consult.

## Signature

- `astro.config.js`, `astro.config.mjs`, or `astro.config.ts` exists
- `package.json` contains an `astro` dependency

## Start command

Standard:

```bash
npm run dev
```

The `dev` script in `package.json` typically wraps `astro dev`. Also valid (read `package.json` scripts to confirm which the project uses):

```bash
pnpm dev
yarn dev
bun run dev
```

Prefer the package manager indicated by the lockfile:
- `pnpm-lock.yaml` -> `pnpm dev`
- `yarn.lock` -> `yarn dev`
- `bun.lock` / `bun.lockb` -> `bun run dev`
- `package-lock.json` or none -> `npm run dev`

## Port

Default: `4321`. Astro respects `--port <port>` and the `server.port` field in `astro.config.*`. Overrides follow the cascade in `references/dev-server-detection.md`.

## Stub generation

```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "name": "Astro dev",
      "runtimeExecutable": "npm",
      "runtimeArgs": ["run", "dev"],
      "port": 4321
    }
  ]
}
```

Substitute the resolved package manager (`npm` / `pnpm` / `yarn` / `bun`) and port.

## Common gotchas

- **SSR vs SSG:** `astro dev` runs identically for both output modes; the difference only matters at build time. Polish does not need to distinguish between them.
- **Astro config takes precedence over Vite config:** Astro uses Vite under the hood but ships its own config file. The `astro` type takes precedence over `vite` when both `astro.config.*` and `vite.config.*` exist. This is rare -- Astro projects do not usually have a separate Vite config file.
- **Dev toolbar (Astro 4+):** Astro 4+ includes a dev toolbar that adds overlay UI in the browser. It does not affect port binding or URL routing -- polish can ignore it.
