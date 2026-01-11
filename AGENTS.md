- To test opencode in the `packages/opencode` directory you can run `bun dev`
- To regenerate the javascript SDK, run ./packages/sdk/js/script/build.ts
- ALWAYS USE PARALLEL TOOLS WHEN APPLICABLE.
- the default branch in this repo is `dev`

## Testing the Web UI

To test changes in the web UI (`packages/app` or `packages/ui`), you need to run **two servers**:

1. **API Server** (in `packages/opencode`):

   ```bash
   cd packages/opencode
   bun dev -- serve --port 5555
   ```

2. **Vite Dev Server** (in `packages/app`):
   ```bash
   cd packages/app
   bun dev
   ```

Then open http://localhost:3000 (Vite dev server with HMR), NOT port 5555 (API only).

The Vite dev server provides hot module reloading so code changes are reflected immediately.
