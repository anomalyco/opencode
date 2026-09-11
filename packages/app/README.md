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

The `deploy` GitHub Actions workflow uses SST to deploy the web app from these branches in `anomalyco/opencode`:

| Branch       | Site                  |
| ------------ | --------------------- |
| `dev`        | `app.dev.opencode.ai` |
| `production` | `app.opencode.ai`     |
| `beta`       | `beta.opencode.ai`    |

Changes merged into `v2` reach the beta site when they are promoted to `beta`. The beta SST stage deploys
only the web app, using the same `WebApp` StaticSite definition as production. It sets the build channel
and Sentry environment to `beta` without deploying the API, console, database, or billing infrastructure.

`VITE_OPENCODE_SERVER_MODE` controls which server the web build provides at startup:

| Mode               | Initial server                                                                       |
| ------------------ | ------------------------------------------------------------------------------------ |
| `none`             | No initial server. The beta deployment uses this mode.                               |
| `origin` (default) | The current page's origin. CLI builds explicitly use this mode for `opencode serve`. |

In Vite development mode, `origin` uses `VITE_OPENCODE_SERVER_HOST` / `VITE_OPENCODE_SERVER_PORT`
(default: `http://localhost:4096`) instead of the frontend origin. Both modes restore user-added servers
from storage. Desktop provides the local server it discovers or starts through native initialization.

With no configured servers, the app shows a full-screen connection form. Enter a server address and password,
or choose **Scan QR code** to open the camera and read the JSON pairing code from `opencode pair`.
Scanning fills the form and immediately attempts to connect. Failed connections leave the details available
to edit and retry with **Connect**. Credentials are checked before saving the server. Camera access requires
HTTPS (or localhost) and browser permission. Saved offline servers continue to use the normal app UI.

When the service is exposed through an HTTPS reverse proxy, advertise its external address at runtime:

```bash
opencode pair --url https://your-machine.your-tailnet.ts.net
```

This replaces the addresses printed and encoded in the QR code while retaining the local service password.
The proxy URL must reach the OpenCode API, not just the frontend. For separate frontend and API processes,
route `/api` to the service while preserving the `/api` prefix. No machine-specific app or CLI build is required.

When an HTTPS page fails to connect to a non-loopback HTTP server, the connection forms show a specific
HTTPS-to-HTTP error instead of the generic connection failure. HTTP servers on `localhost`, `*.localhost`,
`127.0.0.0/8`, or `::1` are treated as trustworthy loopback targets. Connection attempts still run, since
browser local-network permissions can allow some HTTP LAN connections.
QR scanning is enabled only in a browser-reported secure context with camera support and an available
video input; insecure pages and unavailable cameras show an explanation beside the disabled action.

The workflow reuses the repository's `CLOUDFLARE_API_TOKEN` and web Sentry settings. The Cloudflare token
must cover SST's R2 state storage, KV assets, Workers, and custom-domain management in the account that
owns `opencode.ai`. The beta GitHub environment must allow deployments from the `beta` branch; it does not
need AWS credentials.

SST manages the beta site's custom domain. The first deployment creates its DNS record and TLS certificate.
Do not create a CNAME for `beta.opencode.ai` first, because it would conflict with the Workers custom domain.
