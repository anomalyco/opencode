// Bun's fetch aborts a request after its default five-minute deadline. The TUI holds
// requests open far longer than that (plugin commands, session streams), so its client
// opts out the same way the `run` entry point does (packages/cli/src/run/run.ts).
export const noTimeoutFetch = ((request: RequestInfo | URL, init?: RequestInit) =>
  fetch(request, { ...init, timeout: false } as BunFetchRequestInit)) as typeof fetch
