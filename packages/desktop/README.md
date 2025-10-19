## Usage

Those templates dependencies are maintained via [pnpm](https://pnpm.io) via `pnpm up -Lri`.

This is the reason you see a `pnpm-lock.yaml`. That being said, any package manager will work. This file can be safely be removed once you clone a template.

```bash
$ npm install # or pnpm install or yarn install
```

### Learn more on the [Solid Website](https://solidjs.com) and come chat with us on our [Discord](https://discord.com/invite/solidjs)

## Development

### Web Development (Browser)
Run backend + Vite dev server:
```bash
npm run dev:web
```
Then open: `http://127.0.0.1:5173/?directory=/Users/jkneen/Documents/GitHub/flows/opencode-stt/packages/desktop`

### Desktop Development (Tauri Native App)
Run backend + Vite + Tauri:
```bash
npm start
# or
npm run dev:tauri
```

### Services Architecture

The desktop app requires:
1. **OpenCode Backend** (`127.0.0.1:4096`) - API server
2. **Vite Dev Server** (`127.0.0.1:5173`) - UI with proxy to backend
3. **Tauri** - Native app wrapper (optional for browser-only dev)

**Important:** All services use `127.0.0.1` (not `localhost`) to avoid IPv4/IPv6 networking issues.

The startup scripts handle this automatically:
- `npm run dev:web` - Backend + Vite (browser testing)
- `npm start` - Backend + Vite + Tauri (native app)

## Available Scripts

### `npm start` or `npm run dev:tauri`

Runs the Tauri native desktop app with backend and Vite dev server.

### `npm run dev:web`

Runs backend + Vite for browser-based development.<br>
Open [http://127.0.0.1:5173/?directory=/path/to/project](http://127.0.0.1:5173/?directory=/path/to/project)

The page will reload if you make edits.<br>

### `npm run build`

Builds the app for production to the `dist` folder.<br>
It correctly bundles Solid in production mode and optimizes the build for the best performance.

The build is minified and the filenames include the hashes.<br>
Your app is ready to be deployed!

## Deployment

You can deploy the `dist` folder to any static host provider (netlify, surge, now, etc.)
