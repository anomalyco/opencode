## UAT gap: Add local directory picker shows empty list

### Observation

- UI logs: `Unexpected find.files response shape {input: {…}}` from `DialogSelectDirectory`.
- The dialog is empty because the handler returns `[]` on unexpected response.

### Evidence

- `DialogSelectDirectory` calls `sdk.client.find.files({ directory, query, type: "directory", limit: 50 })` and normalizes the response, logging an error if it is not an array or `{ data: string[] }`.

```60:82:packages/app/src/components/dialog-select-directory.tsx
  const results = await sdk.client.find
    .files({ directory, query, type: "directory", limit: 50 })
    .then((x) => normalizeFindFilesResponse(x))
```

- Backend defines `/find/file` returning a raw `string[]`.

```45:83:packages/opencode/src/server/routes/file.ts
    .get(
      "/find/file",
      // ...
      async (c) => {
        const results = await File.search({ query, limit: limit ?? 10, dirs: dirs !== "false", type })
        return c.json(results)
      },
    )
```

- In dev, the UI uses `window.location.origin` as the API base URL, expecting Vite to proxy API routes.

```100:107:packages/app/src/app.tsx
    if (import.meta.env.DEV) return window.location.origin
```

- Vite dev proxy **does not include** `/find` or `/find/file`. Other API routes (e.g. `/file`, `/session`) are proxied.

```10:65:packages/app/vite.config.ts
    proxy: {
      "/auth": { target: "http://localhost:4096", changeOrigin: true },
      "/global": { target: "http://localhost:4096", changeOrigin: true },
      // ...
      "/file": { target: "http://localhost:4096", changeOrigin: true },
    },
```

### Suspected root cause

Requests to `/find/file` from the web app are hitting the Vite dev server (UI origin) instead of the backend because `/find` is missing from the proxy table. The response is not the `string[]` the SDK expects (likely HTML or a dev server fallback payload), so `normalizeFindFilesResponse` logs the unexpected shape and returns `[]`, leaving the dialog empty.

### Suggested fix direction

Ensure `/find` routes are proxied to the backend in `packages/app/vite.config.ts` (and any reverse-proxy config used outside dev). This should restore the `string[]` response shape and populate the directory picker.
