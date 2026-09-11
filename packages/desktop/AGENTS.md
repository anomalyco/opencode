# Desktop (web) package notes

- This package is now a pure React + Vite SPA that runs in the browser. No Electron.
- No `src/main`, no `src/preload`, no `window.api`. Browser APIs only (`fetch`, `EventSource`, `localStorage`).
- Backend is `packages/argus` in server-only mode (`bun run ./src/index.ts` -> `Server.listen`). Configure URL via `localStorage argus.serverUrl` or `VITE_ARGUS_SERVER_URL`. Same-origin `/api` proxy in dev.
- API: `GET /api/session`, `POST /api/session`, `GET /api/session/:id/message`, `POST /api/session/:id/prompt`, `GET /api/event` (SSE).
