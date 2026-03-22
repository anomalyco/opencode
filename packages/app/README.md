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

### License setup

Point `VITE_OPENCODE_LICENSE_URL` at your live license service before starting the app in local development.

```bash
cp .env.example .env.local
bun run dev -- --port 4444
```

<<<<<<< Updated upstream
Open `http://localhost:4444` and use `Settings > License` to verify activation against the configured live service.
=======
Open `http://localhost:4444`, go to `Settings > License`, and paste one of these keys:

- `TEST-ACTIVE-KEY` - unlocks the app
- `TEST-EXPIRED-KEY` - returns an expired license
- `TEST-INVALID-KEY` - returns an invalid license error
- `TEST-GRACE-KEY` - unlocks the app in grace-period mode

The mock service listens on `http://127.0.0.1:8787` by default and exposes:

- `GET /health`
- `GET /keys`
- `POST /v1/licenses/activate`
- `POST /v1/licenses/refresh`
>>>>>>> Stashed changes

### `npm run build`

Builds the app for production to the `dist` folder.<br>
It correctly bundles Solid in production mode and optimizes the build for the best performance.

The build is minified and the filenames include the hashes.<br>
Your app is ready to be deployed!

## E2E Testing

Playwright starts the Vite dev server automatically via `webServer`, and UI tests need an opencode backend (defaults to `localhost:4096`).
Use the local runner to create a temp sandbox, seed data, and run the tests.

```bash
bunx playwright install
bun run test:e2e:local
bun run test:e2e:local -- --grep "settings"
```

Environment options:

- `PLAYWRIGHT_SERVER_HOST` / `PLAYWRIGHT_SERVER_PORT` (backend address, default: `localhost:4096`)
- `PLAYWRIGHT_PORT` (Vite dev server port, default: `3000`)
- `PLAYWRIGHT_BASE_URL` (override base URL, default: `http://localhost:<PLAYWRIGHT_PORT>`)

## Deployment

You can deploy the `dist` folder to any static host provider (netlify, surge, now, etc.)
