export * as RemoteTunnel from "./remote-tunnel"

import type { OpenTunnelError } from "@opentunnel/client/effect"
import { Cause, Effect, Schedule } from "effect"
import { EOL } from "os"
import { OPENCODE_CHANNEL } from "../version"

// OpenTunnel keeps one tunnel per device in its default profile, shared by the opentunnel CLI and every app
// using the SDK; each claims its own routes. The service claims a subdomain rather than the tunnel hostname,
// which the CLI may route, and each channel's service gets its own subdomain.
export function route(channel = OPENCODE_CHANNEL) {
  if (channel === "latest") return "opencode"
  return `opencode-${channel.toLowerCase().replace(/[^a-z0-9-]/g, "-")}`.slice(0, 63).replace(/-+$/, "")
}

// Holds the route for the life of the service. The SDK reconnects through network failures itself, so only
// setup failures reach the retry here; a rejected token or failed certificate stops it for good.
export const run = Effect.fnUntraced(function* (input: {
  readonly target: string
  readonly onURL: (url: string | undefined) => void
}) {
  const { OpenTunnelClient, OpenTunnelAttachError } = yield* Effect.promise(() => import("@opentunnel/client/effect"))
  const fatal = (error: OpenTunnelError) =>
    error._tag === "OpenTunnelClientError" &&
    (error.cause instanceof OpenTunnelAttachError || error.message.startsWith("Certificate issuance failed"))
  yield* Effect.gen(function* () {
    const client = yield* OpenTunnelClient
    const connection = yield* client.tunnel.connect({ routes: { [route()]: input.target } })
    input.onURL(`https://${route()}.${connection.tunnel.hostname}`)
    yield* connection.closed
  }).pipe(
    Effect.scoped,
    Effect.ensuring(Effect.sync(() => input.onURL(undefined))),
    Effect.tapError((error) =>
      fatal(error) ? Effect.void : Effect.logWarning("remote access tunnel unavailable; retrying", { cause: error }),
    ),
    Effect.retry({
      while: (error) => !fatal(error),
      schedule: Schedule.min([Schedule.exponential("1 second"), Schedule.spaced("30 seconds")]),
    }),
    Effect.provide(OpenTunnelClient.layer()),
    Effect.catchCause((cause) =>
      Cause.hasInterruptsOnly(cause)
        ? Effect.failCause(cause)
        : Effect.logError("remote access tunnel stopped; run `opencode service set remote true` to retry", { cause }),
    ),
  )
})

// A device without a tunnel creates its shared one here, in the foreground, because issuing the certificate
// takes a while; the service then only attaches its route on start. An interrupted issuance resumes next time.
export const ensure = Effect.fnUntraced(function* () {
  const { OpenTunnelClient } = yield* Effect.promise(() => import("@opentunnel/client/effect"))
  return yield* Effect.gen(function* () {
    const client = yield* OpenTunnelClient
    if ((yield* client.tunnel.get()) === undefined)
      process.stderr.write("Creating this device's OpenTunnel tunnel; this can take a minute..." + EOL)
    return `${route()}.${(yield* client.tunnel.ensure()).hostname}`
  }).pipe(
    Effect.provide(OpenTunnelClient.layer()),
    Effect.timeoutOrElse({
      duration: "5 minutes",
      orElse: () => Effect.fail(new Error("Timed out creating the remote access tunnel; run the command again to resume")),
    }),
  )
})

// The tunnel hostname is persisted once the certificate is ready, so this is undefined until then.
export const hostname = Effect.fnUntraced(function* () {
  const { OpenTunnelStorage } = yield* Effect.promise(() => import("@opentunnel/client/effect"))
  const identity = yield* OpenTunnelStorage.xdg().load("default")
  return identity === undefined ? undefined : `${route()}.${identity.hostname}`
})
