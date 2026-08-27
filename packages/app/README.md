## Usage

Dependencies for these templates are managed with [pnpm](https://pnpm.io) using `pnpm up -Lri`.

This is the reason you see a `pnpm-lock.yaml`. That said, any package manager will work. This file can safely be removed once you clone a template.

```bash
$ npm install # or pnpm install or yarn install
```

### Learn more on the [Solid Website](https://solidjs.com) and come chat with us on our [Discord](https://discord.com/invite/solidjs)

## Available Scripts

In the project directory, you can run:

### `npm run dev` or `npm start`

Runs the app in the development mode.<br>
Open [http://localhost:3000](http://localhost:3000) to view it in the browser.

The page will reload if you make edits.<br>

### `npm run build`

Builds the app for production to the `dist` folder.<br>
It correctly bundles Solid in production mode and optimizes the build for the best performance.

The build is minified and the filenames include the hashes.<br>
Your app is ready to be deployed!

## E2E Testing

Locally, Playwright starts the Vite dev server automatically via `webServer`, or reuses one already running at the configured address. The browser suite uses isolated API fixtures rather than a live opencode backend.

```bash
bunx playwright install chromium
bun run test:e2e:local
bun run test:e2e:local -- --grep "settings"
```

CI builds the app once and runs the same suite against Vite preview, serving production assets from `dist`. Managed built runs never reuse an existing server, so a running dev server cannot silently replace the production build. To run this mode locally:

```bash
bun run test:e2e:built
bun run test:e2e:built -- --grep "settings"
```

To test an already-running dev server without starting or building a server:

```bash
PLAYWRIGHT_BASE_URL=http://127.0.0.1:4444 bun run test:e2e
```

For an already-running production build, also set `PLAYWRIGHT_BUILD=1` so the fixture API uses the app's origin:

```bash
PLAYWRIGHT_BUILD=1 PLAYWRIGHT_BASE_URL=http://127.0.0.1:4444 bun run test:e2e
```

External targets must use HTTP because fixture URLs use HTTP. `PLAYWRIGHT_BASE_URL` skips server startup and building in either mode.

Compiled CLI startup and service lifecycle coverage runs separately in CI via `packages/cli/script/service-smoke.ts`.

Environment options:

- `PLAYWRIGHT_BUILD=1` (build and preview locally; always enabled when `CI` is set)
- `PLAYWRIGHT_SERVER_HOST` / `PLAYWRIGHT_SERVER_PORT` (dev fixture API address, default: `127.0.0.1:4096`; built runs use the app's origin, matching production)
- `PLAYWRIGHT_PORT` (managed dev or preview server port, default: `3000`)
- `PLAYWRIGHT_BASE_URL` (use an externally managed app instead of starting a server; otherwise defaults to `http://127.0.0.1:<PLAYWRIGHT_PORT>`)

## Deployment

You can deploy the `dist` folder to any static host provider (netlify, surge, now, etc.)
