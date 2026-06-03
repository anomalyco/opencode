# Vite dev-server recipe (auto-detect fallback)

Loaded when `detect-project-type.sh` returns `vite` and there is no `.opencode/launch.json` to consult.

## Signature

- `vite.config.js`, `vite.config.ts`, `vite.config.mjs`, or `vite.config.cjs` exists

## Start command

Standard:

```bash
npm run dev
```

The `dev` script in `package.json` typically wraps `vite` directly. Prefer the package manager indicated by the lockfile (see the Next.js recipe for the lockfile → command mapping).

## Port

Default: `5173`. Vite respects `--port <n>` and the `VITE_PORT` env var. The cascade in `references/dev-server-detection.md` picks up `--port` from `package.json` scripts and `PORT` from `.env*`.

Vite's `--strictPort` flag causes the dev server to fail rather than increment to the next available port when the requested port is in use. Polish's kill-by-port step will reclaim the port before starting, so `strictPort` is not a problem in practice — but users who disable port reclamation and run multiple Vite instances will see the port auto-increment unless `strictPort: true` is set in `vite.config.ts`.

## Host binding

Vite binds to `127.0.0.1` by default. For polish running inside a devcontainer or WSL, users may need `--host 0.0.0.0` in `runtimeArgs`. The checklist can note this if relevant to the diff.

## Stub generation

```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "name": "Vite dev",
      "runtimeExecutable": "npm",
      "runtimeArgs": ["run", "dev"],
      "port": 5173
    }
  ]
}
```

## Common gotchas

- **HMR websocket port:** Vite's HMR uses a separate websocket that inherits the dev-server port by default. If the project pins `server.hmr.port` in `vite.config.ts`, the polish reachability probe against the dev-server port still works, but the embedded browser may need additional configuration to reach HMR.
- **Framework on top of Vite:** SvelteKit, SolidStart, Qwik City, and Astro all use Vite but add their own dev scripts. The `vite` signature catches them, and `npm run dev` is the right command for all of them. Different default ports apply (SvelteKit: 5173, Astro: 4321, Qwik: 5173) — rely on the cascade to pick up the actual port from `package.json` or `.env`.
