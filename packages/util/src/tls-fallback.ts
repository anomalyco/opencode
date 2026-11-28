// Bun's TLS ClientHello carries a post-quantum key share (X25519MLKEM768), which makes it about 1.5 KB: too large for one
// TCP segment. Some networks drop a ClientHello that arrives in two segments, so the handshake to an affected host never
// completes: the request hangs, or fails with ECONNRESET, while clients that send a small ClientHello get through.
//
// This fetch notices that for one host at a time. When a request gets no response, it opens two fresh connections to the
// host, one with each handshake. Only when the standard handshake fails and the classical one completes does the host
// switch to the classical handshake, for the request in flight and the ones after it. Certificate verification and the
// cipher are unchanged; the connection only loses protection against a recorded session being decrypted by a future
// quantum computer.

/** Bun's default key exchange groups without the post-quantum one. The ClientHello shrinks from about 1500 to 280 bytes. */
export const CLASSICAL_GROUPS = "X25519:P-256:P-384"

type Fetch = (input: Request | string | URL, init?: RequestInit) => Promise<Response>

export interface TlsFallbackOptions {
  /** The fetch to send with. Defaults to the runtime's. */
  readonly fetch?: Fetch
  /** How long a request waits for a response before its host is checked. */
  readonly stall?: number
  /** How long a check gives each handshake. */
  readonly probe?: number
  /** How long a host that passed a check is left alone. */
  readonly trust?: number
  /** How long a host stays on the classical handshake before the standard one is tried again. */
  readonly retry?: number
  /** Called each time a check moves a host to the classical handshake. */
  readonly onFallback?: (origin: string) => void
}

// Failures of a connection that never produced a response. A handshake that is reset reports the first two.
const CONNECTION_CODES = new Set(["ECONNRESET", "EPROTO", "ETIMEDOUT", "ConnectionClosed"])

interface Host {
  readonly classical: boolean
  readonly checked: number
  readonly check?: Promise<boolean>
}

/** A fetch that falls back to the classical TLS handshake for hosts whose network path drops the post-quantum one. */
export function tlsFallbackFetch(options: TlsFallbackOptions = {}): Fetch {
  const base = options.fetch ?? globalThis.fetch
  // Only Bun's fetch takes the key exchange groups per request.
  if (typeof Bun === "undefined") return base
  const stall = options.stall ?? 2_000
  const probe = options.probe ?? 3_000
  const trust = options.trust ?? 10 * 60_000
  const retry = options.retry ?? 60 * 60_000
  const hosts = new Map<string, Host>()

  // Any response proves the handshake completed. `keepalive: false` forces a new connection, so a pooled one can't
  // answer for it, and the probe takes the request's own route: its proxy, certificate authority and client certificate.
  const handshakes = (origin: string, init: BunFetchRequestInit | undefined, tls: BunFetchRequestInit["tls"]) =>
    base(origin, {
      method: "HEAD",
      redirect: "manual",
      keepalive: false,
      proxy: init?.proxy,
      tls,
      signal: AbortSignal.timeout(probe),
    } as BunFetchRequestInit).then(
      (response) => {
        void response.body?.cancel()
        return true
      },
      () => false,
    )

  const check = (origin: string, init: BunFetchRequestInit | undefined) => {
    const host = hosts.get(origin)
    if (host?.check) return host.check
    const running = Promise.all([
      handshakes(origin, init, init?.tls),
      handshakes(origin, init, classical(init).tls),
    ]).then(([standard, small]) => {
      // Neither completing says nothing about the handshake (no network, host down), so the next failure checks again.
      if (!standard && !small) {
        hosts.delete(origin)
        return false
      }
      hosts.set(origin, { classical: !standard, checked: Date.now() })
      if (!standard && !host?.classical) options.onFallback?.(origin)
      return !standard
    })
    hosts.set(origin, { classical: host?.classical ?? false, checked: host?.checked ?? 0, check: running })
    return running
  }

  const blocked = (origin: string, init: BunFetchRequestInit | undefined) => {
    const host = hosts.get(origin)
    if (host && !host.check && Date.now() - host.checked < trust) return Promise.resolve(host.classical)
    return check(origin, init)
  }

  return (input, init) => {
    const url = input instanceof Request ? input.url : String(input)
    const request = init as BunFetchRequestInit | undefined
    if (!url.startsWith("https:") || (request?.tls as { ecdhCurve?: string } | undefined)?.ecdhCurve)
      return base(input, init)
    const origin = new URL(url).origin
    const host = hosts.get(origin)
    if (host?.classical) {
      // Runs beside the request, so a host that is still filtered costs nothing.
      if (!host.check && Date.now() - host.checked >= retry) void check(origin, request)
      return base(input, classical(request))
    }
    // The first attempt may have consumed a streamed body, so only the requests after it take the classical handshake.
    const replayable =
      (input instanceof Request ? input.body === null : true) && !(init?.body instanceof ReadableStream)
    return new Promise<Response>((resolve, reject) => {
      const first = new AbortController()
      let open = true
      const settle = () => {
        if (!open) return false
        open = false
        clearTimeout(timer)
        return true
      }
      const timer = setTimeout(() => {
        void blocked(origin, request).then((yes) => {
          if (!yes || !replayable || !settle()) return
          first.abort()
          resolve(base(input, classical(request)))
        })
      }, stall)
      base(input, {
        ...init,
        signal: AbortSignal.any(
          [first.signal, init?.signal, input instanceof Request ? input.signal : undefined].filter(
            (signal) => signal != null,
          ),
        ),
      }).then(
        (response) => {
          if (settle()) resolve(response)
        },
        (error: { code?: unknown } | undefined) => {
          if (!open) return
          if (typeof error?.code !== "string" || !CONNECTION_CODES.has(error.code)) {
            settle()
            reject(error)
            return
          }
          void blocked(origin, request).then((yes) => {
            if (!settle()) return
            if (yes && replayable) return resolve(base(input, classical(request)))
            reject(error)
          })
        },
      )
    })
  }
}

const classical = (init: BunFetchRequestInit | undefined) =>
  ({ ...init, tls: { ...init?.tls, ecdhCurve: CLASSICAL_GROUPS } }) as BunFetchRequestInit
