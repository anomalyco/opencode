# Remix dev-server recipe (auto-detect fallback)

Loaded when `detect-project-type.sh` returns `remix` and there is no `.opencode/launch.json` to consult.

## Signature

- `remix.config.js` or `remix.config.ts` exists (classic Remix)
- Remix 2.x+ on Vite has no `remix.config.*` -- it uses `vite.config.ts` with the Remix plugin, so it resolves as `vite` type, not `remix`

## Start command

Standard:

```bash
npm run dev
```

The `dev` script in `package.json` typically wraps `remix dev`. Also valid (read `package.json` scripts to confirm which the project uses):

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

Default: `3000`. Remix respects `--port <port>` flag. Classic Remix dev server also reads the `PORT` env var. Overrides follow the cascade in `references/dev-server-detection.md`.

## Stub generation

```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "name": "Remix dev",
      "runtimeExecutable": "npm",
      "runtimeArgs": ["run", "dev"],
      "port": 3000
    }
  ]
}
```

Substitute the resolved package manager (`npm` / `pnpm` / `yarn` / `bun`) and port.

## Common gotchas

- **Classic vs Vite:** Classic Remix uses `remix.config.js`; new Remix (v2+) uses Vite -- detected as `vite` type, not `remix`. The `remix` type is specifically for classic Remix projects that still have a `remix.config.*` file.
- **Remix v1 vs v2 dev server:** `remix dev` in v2 starts an Express-based dev server that binds a port; `remix dev` in v1 was a watcher only (no server). Polish needs v2+ for the dev server to bind a port and respond to reachability probes.
- **Remix on Vite inherits Vite's port:** When Remix runs on Vite (no `remix.config.*`), the default port is 5173 (Vite's default), not 3000. That case is handled by the `vite` recipe, not this one.
