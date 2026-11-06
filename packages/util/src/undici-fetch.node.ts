import { Agent, fetch as undiciFetch } from "undici"

type Fetch = typeof globalThis.fetch

// Node's built-in fetch enforces undici's default 300s headersTimeout and bodyTimeout, which kills slow
// providers and SSE streams with long gaps regardless of the provider's own timeout settings. Those limits
// are already enforced above this layer (headerTimeout, chunkTimeout, timeout), so the socket-level ones are
// turned off. The Agent only works with undici's own fetch: Node's bundled undici rejects an undici@8 Agent
// (UND_ERR_INVALID_ARG). Bun's fetch has no such defaults, so it keeps its own.
export function create(runtime: { readonly bun?: string } = process.versions): Fetch | undefined {
  if (runtime.bun) return undefined
  const dispatcher = new Agent({ headersTimeout: 0, bodyTimeout: 0 })
  return Object.assign(
    (input: Parameters<Fetch>[0], init?: RequestInit) =>
      undiciFetch(input as Parameters<typeof undiciFetch>[0], { ...(init as object), dispatcher }) as unknown as Promise<Response>,
    { preconnect: globalThis.fetch.preconnect },
  )
}
