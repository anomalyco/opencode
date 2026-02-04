## Request throttling

Debounce and cancel high-frequency server calls

---

### Summary

Some user interactions trigger bursts of server requests that can overlap and return out of order. We’ll debounce frequent triggers and cancel in-flight requests (or ignore stale results) for file search and LSP refresh.

---

### Goals

- Reduce redundant calls from file search and LSP refresh
- Prevent stale responses from overwriting newer UI state
- Preserve responsive typing and scrolling during high activity

---

### Non-goals

- Changing server-side behavior or adding new endpoints
- Implementing global request queues for all SDK calls
- Persisting search results across reloads

---

### Current state

- File search calls `sdk.client.find.files` via `files.searchFilesAndDirectories`.
- LSP refresh is triggered frequently (exact call sites vary, but the refresh behavior is high-frequency).
- Large UI modules involved include `packages/app/src/pages/layout.tsx` and `packages/app/src/components/prompt-input.tsx`.

---

### Proposed approach

- Add a small request coordinator utility:
  - debounced triggering (leading/trailing configurable)
  - cancellation via `AbortController` when supported
  - stale-result protection via monotonic request ids when abort is not supported
- Integrate coordinator into:
  - `files.searchFilesAndDirectories` (wrap `sdk.client.find.files`)
  - LSP refresh call path (wrap refresh invocation and ensure only latest applies)

---

### Phased implementation steps

1. Add a debounced + cancellable helper

- Create `packages/app/src/utils/requests.ts` with:
  - `createDebouncedAsync(fn, delayMs)`
  - `createLatestOnlyAsync(fn)` that drops stale responses
- Prefer explicit, readable primitives over a single complex abstraction.

Sketch:

```ts
function createLatestOnlyAsync<TArgs extends unknown[], TResult>(
  fn: (args: { input: TArgs; signal?: AbortSignal }) => Promise<TResult>,
) {
  let id = 0
  let controller: AbortController | undefined

  return async (...input: TArgs) => {
    id += 1
    const current = id
    controller?.abort()
    controller = new AbortController()

    const result = await fn({ input, signal: controller.signal })
    if (current !== id) return
    return result
  }
}
```

2. Apply to file search

- Update `files.searchFilesAndDirectories` to:
  - debounce input changes (e.g. 150–300 ms)
  - abort prior request when a new query begins
  - ignore results if they are stale
- Ensure “empty query” is handled locally without calling the server.

3. Apply to LSP refresh

- Identify the refresh trigger points used during typing and file switching.
- Add:
  - debounce for rapid triggers (e.g. 250–500 ms)
  - cancellation for in-flight refresh if supported
  - last-write-wins behavior for applying diagnostics/results

4. Add feature flags and metrics

- Add flags:
  - `requests.debounce.fileSearch`
  - `requests.latestOnly.lspRefresh`
- Add simple dev-only counters for “requests started / aborted / applied”.

---

### Data migration / backward compatibility

- No persisted data changes.
- Behavior is compatible as long as UI state updates only when the “latest” request resolves.

---

### Risk + mitigations

- Risk: aggressive debounce makes UI feel laggy.
  - Mitigation: keep delays small and tune separately for search vs refresh.
- Risk: aborting requests may surface as errors in logs.
  - Mitigation: treat `AbortError` as expected and do not log it as a failure.
- Risk: SDK method may not accept `AbortSignal`.
  - Mitigation: use request-id stale protection even without true cancellation.

---

### Validation plan

- Manual scenarios:
  - type quickly in file search and confirm requests collapse and results stay correct
  - trigger LSP refresh repeatedly and confirm diagnostics do not flicker backward
- Add a small unit test for latest-only behavior (stale results are ignored).

---

### Rollout plan

- Ship helpers behind flags default off.
- Enable file search debounce first (high impact, easy to validate).
- Enable LSP latest-only next, then add cancellation if SDK supports signals.
- Keep a quick rollback by disabling the flags.

---

### Open questions

- Does `sdk.client.find.files` accept an abort signal today, or do we need stale-result protection only?
- Where is LSP refresh initiated, and does it have a single chokepoint we can wrap?
- What debounce values feel best for common repos and slower machines?
