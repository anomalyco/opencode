## UAT gap: New session repo selector blocked

### Observation

- UAT Test 6 reports the repo selector UI renders but behaviors are blocked.
- Earlier UAT failures show Add local directory picker empty and clone progress 404s.

### Evidence

- `NewSessionView` renders `RepoSelector` in the new session view. The selector is the only way to choose a repo and load branches.

```63:91:packages/app/src/components/session/session-new-view.tsx
      <RepoSelector currentPath={currentRepoPath()} onOpenRepo={openRepo} />
      <div class="flex justify-center items-center gap-1">
        <Icon name="branch" size="small" />
        <Select
          options={options()}
          current={current()}
          value={(x) => x}
          label={label}
```

- `RepoSelector` depends on `repo.list` to populate the repo dropdown; errors return `[]` silently, and branches only load when a repo is selected.

```27:69:packages/app/src/components/repo/repo-selector.tsx
  const [repos, { refetch }] = createResource(async () => {
    try {
      return (await globalSDK.client.repo.list()).data ?? []
    } catch {
      return []
    }
  })
  const repoList = createMemo(() => {
    const value = repos()
    if (!Array.isArray(value)) {
      console.error("Unexpected repo list shape", { value })
      return []
    }
    return value
  })
```

- Add local uses `find.files` to populate the directory picker; unexpected response shape yields `[]` and logs a console error.

```60:83:packages/app/src/components/dialog-select-directory.tsx
  const results = await sdk.client.find
    .files({ directory, query, type: "directory", limit: 50 })
    .then((x) => normalizeFindFilesResponse(x))
    .catch(() => [])
```

- Clone uses `EventSource` to hit `${server.url}/repo/clone-progress` and surfaces “Connection to the server was lost” when the endpoint 404s.

```42:101:packages/app/src/hooks/use-clone-progress.ts
    const eventSource = new EventSource(`${baseUrl}/repo/clone-progress?${params.toString()}`, {
      withCredentials: true,
    })
    // ...
    eventSource.addEventListener("error", () => {
      if (!receivedFinalEvent) {
        options.onError("Connection to the server was lost")
      }
      closeEventSource()
    })
```

- The Vite dev proxy does not include `/repo` or `/find`, so dev requests target the frontend origin instead of the backend.

```12:65:packages/app/vite.config.ts
    proxy: {
      "/auth": { target: "http://localhost:4096", changeOrigin: true },
      // ...
      "/file": { target: "http://localhost:4096", changeOrigin: true },
    },
```

- UAT reports in Phase 16 confirm `find.files` response shape errors and `/repo/clone-progress` 404s; repo selector test is blocked by these failures.

```44:90:.planning/phases/16-allow-the-user-to-download-git-repos-so-that-they-can-work-on-them-with-their-opencode-sessions/16-UAT.md
### 6. New session repo selector
expected: The new session view shows the repo selector, allows choosing a repo, and updates branches for the selected repo.
result: issue
reported: "the ui is there but I am blocked from testing the behaviors"
```

### Suspected root cause

- In dev/UAT, the UI base URL is the frontend origin. Because `/repo` and `/find` are not proxied to the backend, the repo list, add-local directory search, and clone progress requests hit the frontend dev server and fail (404 or unexpected response shape). This leaves `repo.list` empty and blocks selection and branch loading.

### Suggested fix direction

- Add `/repo` and `/find` to the Vite proxy table in `packages/app/vite.config.ts` (or point the dev API base URL at the backend port). This should restore `repo.list`, directory picker results, and clone progress streaming so the repo selector can be exercised.
