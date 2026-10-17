import { EnvHttpProxyAgent, fetch } from "undici"

type Fetch = typeof globalThis.fetch

// Node's fetch applies undici's default 300s headersTimeout and bodyTimeout, which end a request to a model that
// thinks for five minutes before provider routes' own header, chunk, and total timeouts apply. Like Bun's fetch,
// the agent honors HTTP_PROXY, HTTPS_PROXY, and NO_PROXY.
const dispatcher = new EnvHttpProxyAgent({ headersTimeout: 0, bodyTimeout: 0 })

export function withoutRuntimeTimeouts(runtime: Fetch): Fetch {
  // A fetch supplied by a host, plugin, or test stays in charge.
  if (runtime !== globalThis.fetch) return runtime
  return Object.assign(
    (input: Parameters<Fetch>[0], init?: RequestInit) =>
      // Node's built-in fetch rejects an agent from a different undici release, and undici's fetch cannot read the
      // built-in Request and FormData classes, so those requests keep the built-in fetch and its timeouts.
      input instanceof Request || init?.body instanceof FormData
        ? runtime(input, init)
        : (fetch(input, { ...init, dispatcher } as Parameters<typeof fetch>[1]) as unknown as Promise<Response>),
    { preconnect: runtime.preconnect },
  )
}
