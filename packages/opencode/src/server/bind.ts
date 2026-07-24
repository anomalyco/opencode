// Bind-failure diagnostics for `Server.listen`.
//
// Two problems make a failed bind undiagnosable without help:
//
//  1. Effect's `HttpServerError.ServeError` is a `Data.TaggedError` whose
//     `message` is empty — the real `listen` error is parked on `.cause`, so a
//     naive rethrow prints the bare string "ServeError".
//  2. Bun's `node:http` shim reports *every* `listen()` failure as `EADDRINUSE`
//     ("Failed to start server. Is port N in use?"), discarding the real errno.
//     Node returns EADDRNOTAVAIL / EACCES for the same binds. So errno dispatch
//     alone cannot tell a busy port from a hostname that isn't on this machine.
//
// `assertBindable` handles (2) by checking the address before we ever call
// `listen`, where an exact answer is available. `bindError` handles (1) by
// walking the cause chain and translating whatever errno survives.
import { isIP } from "node:net"
import { networkInterfaces } from "node:os"

const WILDCARD_HOSTS = new Set(["0.0.0.0", "::", "localhost", "127.0.0.1", "::1"])

export type BindTarget = {
  hostname: string
  port: number
}

export function localAddresses(interfaces = networkInterfaces()) {
  return [
    ...new Set(
      Object.values(interfaces)
        .flatMap((entries) => entries ?? [])
        .map((entry) => entry.address),
    ),
  ]
}

/**
 * Throw before binding when `hostname` is a literal IP that no local interface
 * owns — the common case being a VPN/Tailscale address whose interface is down.
 * Hostnames are left alone; `listen` resolves those.
 */
export function assertBindable(target: BindTarget, interfaces = networkInterfaces()) {
  const { hostname } = target
  if (WILDCARD_HOSTS.has(hostname)) return
  if (!isIP(hostname)) return
  const local = localAddresses(interfaces)
  // Link-local IPv6 may be written with a zone id (fe80::1%en0); compare bare.
  const bare = hostname.split("%")[0]
  if (local.some((address) => address === hostname || address.split("%")[0] === bare)) return
  throw new Error(
    `Cannot bind to ${hostname}: it is not an address on any local network interface.` +
      ` Available: ${local.join(", ")}.` +
      ` Use 0.0.0.0 to listen on every interface, or bring the interface up first (e.g. start Tailscale/VPN).`,
  )
}

/**
 * Translate a failed bind into a message that names the address and the fix.
 * Falls back to the deepest cause message so we never print nothing.
 */
export function bindError(error: unknown, target: BindTarget) {
  const { hostname, port } = target
  const label = `${hostname}:${port}`
  const wrap = (message: string) => new Error(message, { cause: error })

  let cause: unknown = error
  const seen = new Set<unknown>()
  let deepest: unknown = error
  while (cause && typeof cause === "object" && !seen.has(cause)) {
    seen.add(cause)
    deepest = cause
    const code = (cause as { code?: unknown }).code
    if (code === "EADDRINUSE") {
      // Bun folds EACCES into EADDRINUSE, and a privileged port is the far more
      // likely explanation below 1024 — say so rather than blaming a conflict.
      if (port > 0 && port < 1024)
        return wrap(
          `Cannot bind ${label}: ports below 1024 are privileged. Use a port >= 1024, or run with elevated privileges.`,
        )
      return wrap(
        `Address ${label} is already in use. Choose a different --port, use --port 0 to pick a free one,` +
          ` or stop the process holding it.`,
      )
    }
    if (code === "EADDRNOTAVAIL")
      return wrap(
        `Cannot bind to ${label}: "${hostname}" is not an address on this machine.` +
          ` Use a local interface address, 127.0.0.1, or 0.0.0.0.`,
      )
    if (code === "EACCES")
      return wrap(`Permission denied binding ${label}. Ports below 1024 require elevated privileges.`)
    cause = (cause as { cause?: unknown }).cause
  }

  const detail = deepest instanceof Error && deepest.message ? `: ${deepest.message}` : ""
  return wrap(`Failed to start server on ${label}${detail}`)
}
