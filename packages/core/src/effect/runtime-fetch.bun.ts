type Fetch = typeof globalThis.fetch

// Bun's fetch ends a request after five quiet minutes, before provider routes' own header, chunk, and total timeouts.
export function withoutRuntimeTimeouts(runtime: Fetch): Fetch {
  return Object.assign(
    (input: Parameters<Fetch>[0], init?: RequestInit) =>
      runtime(input, { ...init, timeout: false } as BunFetchRequestInit),
    { preconnect: runtime.preconnect },
  )
}
