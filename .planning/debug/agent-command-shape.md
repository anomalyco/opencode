## UAT gap: Unexpected agent/command list shape

### Observation

- Console errors: `Unexpected agent list shape Object` and `Unexpected command list shape` when opening the repository manager dialog (Phase 16 UAT Test 1).
- UI expects `agent` and `command` lists to be arrays, but received non-array responses.

### Evidence

- Agent/command list validation logs in the UI:

```373:392:packages/app/src/components/prompt-input.tsx
  const agents = sync.data.agent
  if (!Array.isArray(agents)) {
    console.error("Unexpected agent list shape", { agents })
    return []
  }
  ...
  const commands = sync.data.command
  if (!Array.isArray(commands)) {
    console.error("Unexpected command list shape", { commands })
    return []
  }
```

- Lists are loaded via SDK calls in `GlobalSyncProvider`:

```215:241:packages/app/src/context/global-sync.tsx
  const blockingRequests = {
    agent: () => sdk.app.agents().then((x) => setStore("agent", x.data ?? [])),
  }
  ...
  Promise.all([
    sdk.command.list().then((x) => setStore("command", x.data ?? [])),
  ])
```

- SDK endpoints are `/agent` and `/command`:

```855:862:packages/sdk/js/src/gen/sdk.gen.ts
  public agents<ThrowOnError extends boolean = false>(options?: Options<AppAgentsData, ThrowOnError>) {
    return (options?.client ?? this._client).get<AppAgentsResponses, unknown, ThrowOnError>({
      url: "/agent",
      ...options,
    })
  }
```

```703:711:packages/sdk/js/src/gen/sdk.gen.ts
  public list<ThrowOnError extends boolean = false>(options?: Options<CommandListData, ThrowOnError>) {
    return (options?.client ?? this._client).get<CommandListResponses, unknown, ThrowOnError>({
      url: "/command",
      ...options,
    })
  }
```

- In dev, API base URL is `window.location.origin`, so Vite must proxy API routes:

```100:107:packages/app/src/app.tsx
  if (import.meta.env.DEV) return window.location.origin
```

- Vite proxy table **does not include** `/agent` or `/command` routes:

```12:73:packages/app/vite.config.ts
  proxy: {
    "/auth": { target: "http://localhost:4096", changeOrigin: true },
    "/global": { target: "http://localhost:4096", changeOrigin: true },
    ...
    "/file": { target: "http://localhost:4096", changeOrigin: true },
  },
```

- Backend routes exist for both endpoints and return arrays:

```269:288:packages/opencode/src/server/server.ts
  .get("/command", async (c) => {
    const commands = await Command.list()
    return c.json(commands)
  })
```

```343:362:packages/opencode/src/server/server.ts
  .get("/agent", async (c) => {
    const modes = await Agent.list()
    return c.json(modes)
  })
```

### Suspected root cause

When running the web UI in dev, requests to `/agent` and `/command` are sent to the Vite dev server (same origin) because those routes are missing from the proxy table. Vite responds with an HTML fallback or a non-array object, causing the client to log `Unexpected agent list shape` and `Unexpected command list shape`.

### Suggested fix direction

Add `/agent` and `/command` to `packages/app/vite.config.ts` proxy config (and any other dev reverse-proxy config). This should ensure the SDK responses are arrays and remove the console errors.
