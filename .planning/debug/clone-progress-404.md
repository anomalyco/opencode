## Clone progress 404 investigation

### Observed symptom

- UAT Test 3 reports `GET http://localhost:3001/repo/clone-progress?...` returns 404 and the dialog shows "Connection to the server was lost."

### Evidence

- Server has `GET /repo/clone-progress` and `POST /repo/clone-progress` routes implemented in `packages/opencode/src/server/routes/repo.ts`. Routes are registered under `/repo` in `packages/opencode/src/server/server.ts`.
- The UI uses `useCloneProgress` to open `EventSource` against `${server.url}/repo/clone-progress` and falls back to error on connection loss in `packages/app/src/hooks/use-clone-progress.ts`.
- In dev, the app defaults `server.url` to `window.location.origin` when `import.meta.env.DEV` is true in `packages/app/src/app.tsx`.
- Vite dev proxy forwards a set of API prefixes to `http://localhost:4096`, but does not include `/repo` in `packages/app/vite.config.ts`.

### Suspected root cause

- In dev, the app targets the frontend origin (`localhost:3001` in UAT) for API requests. Since the Vite proxy does not forward `/repo`, `GET /repo/clone-progress` hits the frontend dev server instead of the backend (`localhost:4096`), resulting in 404 and a lost connection in the dialog.

### Suggested fix direction

- Add `/repo` to the Vite proxy list in `packages/app/vite.config.ts`, or change the dev default server URL to point to the backend port (4096) for clone progress requests.
