type Fetch = typeof globalThis.fetch

// Provider routes enforce their own header, chunk, and total timeouts; workerd keeps its platform fetch unchanged.
export function withoutRuntimeTimeouts(runtime: Fetch): Fetch {
  return runtime
}
