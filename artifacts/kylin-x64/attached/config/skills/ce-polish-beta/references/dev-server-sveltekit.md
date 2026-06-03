# SvelteKit dev-server recipe (auto-detect fallback)

Loaded when `detect-project-type.sh` returns `sveltekit` and there is no `.opencode/launch.json` to consult.

## Signature

- `svelte.config.js`, `svelte.config.mjs`, or `svelte.config.ts` exists
- `package.json` contains a `@sveltejs/kit` dependency

## Start command

Standard:

```bash
npm run dev
```

The `dev` script in `package.json` typically wraps `vite dev` via SvelteKit. Also valid (read `package.json` scripts to confirm which the project uses):

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

Default: `5173` (inherited from Vite). SvelteKit respects `--port <port>` flag and Vite's `server.port` config in `vite.config.ts`. Overrides follow the cascade in `references/dev-server-detection.md`.

## Stub generation

```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "name": "SvelteKit dev",
      "runtimeExecutable": "npm",
      "runtimeArgs": ["run", "dev"],
      "port": 5173
    }
  ]
}
```

Substitute the resolved package manager (`npm` / `pnpm` / `yarn` / `bun`) and port.

## Common gotchas

- **Vite under the hood:** SvelteKit uses Vite internally -- same port default (5173), same HMR behavior. The `sveltekit` type exists because `svelte.config.js` is a more precise signal than a generic `vite.config.ts`, allowing polish to generate a SvelteKit-specific stub name and label.
- **Adapter does not matter for dev:** `adapter-auto`, `adapter-node`, `adapter-static`, and other adapters all produce the same dev server. The adapter only affects the production build output.
- **`svelte.config.js` is the primary signature:** `svelte.config.js` always exists in SvelteKit projects, even when `vite.config.ts` also exists. This is the file that distinguishes a SvelteKit project from a plain Vite project.
