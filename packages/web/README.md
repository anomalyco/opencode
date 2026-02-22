# OpenCode Web - SolidJS + Hono Client

A minimal, performant web application for OpenCode sessions using SolidJS for the client and Hono for the worker.

## Quick Start

### Prerequisites

- Node.js 18+ or Bun
- Wrangler CLI

### Installation

```bash
# Install dependencies
bun install

# Or with npm
npm install
```

### Development

The development setup requires three running servers communicating together:

**Terminal 1: Vite Dev Server (Port 5173)**

```bash
cd packages/web
vite dev
```

Serves the SolidJS client with hot module replacement (HMR).

**Terminal 2: Web Worker (Port 8787)**

```bash
cd packages/web
wrangler dev --env dev
```

Proxies requests to Vite and the sessions API. Access the app at `http://localhost:8787`.

**Terminal 3: Sessions API Worker (Port 8788)**

```bash
cd packages/cloudsession
wrangler dev --env dev --port 8788
```

Serves the API endpoints that the web worker proxies to.

**In Browser**
Open `http://localhost:8787` to access the app.

### Build & Deploy

```bash
# Build the SolidJS client and prepare assets
bun run build

# Deploy web worker to Cloudflare
wrangler deploy

# Deploy sessions API worker
cd ../cloudsession
wrangler deploy
```

The build process:

1. Vite compiles SolidJS components to optimized JavaScript
2. Assets are copied to `dist/` directory
3. The worker at `src/worker.ts` is bundled as the entry point
4. All files in `dist/` are served as static assets by the worker

## Architecture

### Worker (Hono)

- Routes requests to the sessions API service binding
- Serves static assets
- Serves the SPA (Single Page Application)

### Client (SolidJS)

- Fully client-side rendered
- Client-side routing for `/` and `/s/:id` pages
- Uses API helpers to communicate with the worker

## File Structure

```
src/
├── index.html           # HTML entry point
├── client.tsx           # SolidJS mount point
├── worker.ts            # Hono worker application
├── App.tsx              # Client router component
├── api.ts               # API client utilities
├── components/          # SolidJS components
│   ├── Share.tsx
│   └── SessionsList.tsx
└── assets/              # Static assets
```

## Configuration

### Environment Variables

In `wrangler.jsonc`:

- `SESSIONS_API` - Service binding to sessions API worker

### API Routes

The worker proxies these routes:

- `GET /api/sessions` - List all sessions
- `GET /api/share/:id` - Get session share data
- `POST /api/share` - Create a new share
- `POST /api/share/:id/sync` - Sync share data

## Troubleshooting

### API Not Responding

Ensure all three servers are running:

- Vite dev server on port 5173
- Web worker on port 8787
- Sessions API on port 8788

Check the web worker logs for proxy errors. The worker logs API requests with `[API Proxy]` prefix.

### "Vite dev server not running" Error

The web worker proxies to `http://localhost:5173` in development. Make sure Vite is running:

```bash
cd packages/web && vite dev
```

### "Sessions API not running" Error

The web worker proxies API requests to `http://localhost:8788`. Make sure the sessions API worker is running:

```bash
cd packages/cloudsession && wrangler dev --env dev --port 8788
```

### Port Already in Use

Change the port configuration in `wrangler.jsonc`:

- Web worker: Change `dev.port` (default 8787)
- Sessions API: Pass `--port` flag to wrangler dev

### Styling Issues

Ensure CSS modules are imported correctly. Vite handles `.module.css` files automatically.

## Performance Notes

- **Client-side rendering**: All UI rendering happens in the browser
- **Minimal bundle**: Only SolidJS reactivity (core) in the bundle
- **API proxying**: Worker acts as a gateway to the sessions API
- **Streaming support**: Hono on Cloudflare Workers supports streaming responses

## Migration from Astro

See [MIGRATION.md](./MIGRATION.md) for details on why Astro SSR was replaced with this approach.
