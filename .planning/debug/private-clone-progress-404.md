# Private clone progress 404

## Symptom

- UAT Test 4 (private clone): `GET /repo/clone-progress?url=...` returns 404; clone dialog shows "Connection to the server was lost."

## Evidence

- Clone dialog uses `useCloneProgress`, which starts with `EventSource` to `GET /repo/clone-progress` on initial attempt and switches to `POST /repo/clone-progress` when retrying with credentials. Both rely on the same route.

```
42:105:packages/app/src/hooks/use-clone-progress.ts
const eventSource = new EventSource(`${baseUrl}/repo/clone-progress?${params.toString()}`, {
  withCredentials: true,
})
...
const response = await requestFetch(`${baseUrl}/repo/clone-progress`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
```

- Backend defines both `GET /repo/clone-progress` and `POST /repo/clone-progress` routes under `RepoRoutes`, mounted at `/repo`.

```
208:330:packages/opencode/src/server/routes/repo.ts
.get(
  "/clone-progress",
  ...
)
.post(
  "/clone-progress",
  ...
)
```

```
168:179:packages/opencode/src/server/server.ts
.route("/repo", RepoRoutes())
```

- In dev, the app uses `window.location.origin` as the server URL and relies on the Vite dev server proxy. The Vite proxy list does **not** include `/repo`, so `/repo/clone-progress` is handled by the frontend dev server and returns 404.

```
100:107:packages/app/src/app.tsx
if (import.meta.env.DEV) return window.location.origin
```

```
10:65:packages/app/vite.config.ts
proxy: {
  "/auth": { target: "http://localhost:4096", changeOrigin: true },
  "/global": { target: "http://localhost:4096", changeOrigin: true },
  ...
  "/file": { target: "http://localhost:4096", changeOrigin: true },
},
```

## Suspected root cause

Missing `/repo` proxy in `packages/app/vite.config.ts` causes both public and private clone progress requests to hit the app dev server instead of the backend, producing 404. This matches Test 3 and Test 4 symptoms (same endpoint).

## Suggested fix direction

- Add `/repo` (and likely `/repo/clone-progress` SSE) to the Vite dev proxy list so `GET` and `POST` requests reach the backend in dev/UAT runs.
- Alternatively, set the default server URL to the backend origin in the test environment (e.g., `http://localhost:4096`) to avoid relying on proxy.
