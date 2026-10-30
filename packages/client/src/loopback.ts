const ipv4Loopback = /^127(?:\.(?:25[0-5]|2[0-4]\d|1?\d?\d)){3}$/

export function isLoopbackUrl(input: URL | string) {
  const url = typeof input === "string" ? (URL.canParse(input) ? new URL(input) : undefined) : input
  if (url === undefined) return false
  const host = url.hostname.toLowerCase().replace(/\.$/, "")
  return host === "localhost" || host.endsWith(".localhost") || host === "[::1]" || ipv4Loopback.test(host)
}

type Fetch = typeof globalThis.fetch

// Bun routes loopback fetch() calls through HTTP(S)_PROXY/ALL_PROXY unless proxy: false is set on the request;
// browsers and Node's fetch ignore the extra field.
export const loopbackAwareFetch: Fetch = Object.assign(
  (input: Parameters<Fetch>[0], init?: Parameters<Fetch>[1]) => {
    const url = input instanceof Request ? input.url : String(input)
    return globalThis.fetch(input, isLoopbackUrl(url) ? Object.assign({}, init, { proxy: false as const }) : init)
  },
  { preconnect: () => undefined },
)
