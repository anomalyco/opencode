// Bun's fetch aborts requests after its default idle deadline (about five minutes). Clients that
// hold requests open for long-running work (session waits, event streams, plugin commands,
// shell calls) opt out while keeping every other init option, including `signal`.
export const noTimeoutFetch = ((request: Parameters<typeof fetch>[0], init?: RequestInit) =>
  fetch(request, { ...init, timeout: false } as BunFetchRequestInit)) as typeof fetch
