export * as RemoteTunnel from "./remote-tunnel"

import type { OpenTunnelError } from "@opentunnel/client/effect"
import { Cause, Effect, Schedule } from "effect"
import { EOL } from "os"
import { OPENCODE_CHANNEL } from "../version"

// Each channel runs its own service, and an OpenTunnel profile holds one tunnel whose routes one bridge
// may claim at a time, so channels get separate profiles.
const profile =
  OPENCODE_CHANNEL === "latest" ? "opencode" : `opencode-${OPENCODE_CHANNEL.replace(/[^a-zA-Z0-9._-]/g, "-")}`

// Holds the tunnel for the life of the service. The SDK reconnects through network failures itself, so only
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
    const connection = yield* client.tunnel.connect({ profile, routes: { "@": input.target } })
    input.onURL(`https://${connection.tunnel.hostname}`)
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

// Creating a tunnel waits for certificate issuance, so do it in the foreground when remote access is enabled;
// the service then only reattaches on start. An interrupted issuance resumes on the next attempt.
export const ensure = Effect.fnUntraced(function* () {
  const { OpenTunnelClient } = yield* Effect.promise(() => import("@opentunnel/client/effect"))
  return yield* Effect.gen(function* () {
    const client = yield* OpenTunnelClient
    if ((yield* client.tunnel.get({ profile })) === undefined)
      process.stderr.write("Creating the remote access tunnel; this can take a minute..." + EOL)
    return (yield* client.tunnel.ensure({ profile })).hostname
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
  return (yield* OpenTunnelStorage.xdg().load(profile))?.hostname
})
