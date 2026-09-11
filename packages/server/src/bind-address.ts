import { Effect } from "effect"
import { lookup } from "node:dns/promises"
import { isIP } from "node:net"

// Node binds a DNS hostname to a single looked-up address (usually IPv6), so
// resolve first and bind every address.
export function resolveBindAddresses(hostname: string) {
  if (isIP(hostname) !== 0) return Effect.succeed([hostname])
  return Effect.tryPromise(() => lookup(hostname, { all: true })).pipe(
    Effect.mapError((cause) => new Error(`Could not resolve hostname "${hostname}"`, { cause })),
    Effect.flatMap((results) => {
      const addresses = [...new Set(results.map((result) => result.address))]
      if (addresses.length === 0)
        return Effect.fail(new Error(`Could not resolve hostname "${hostname}": no addresses found`))
      return Effect.succeed(addresses)
    }),
  )
}
