import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { Api } from "../api"
import { ServerInfo } from "../server-info"
import { ServerPairing } from "../pairing"
import { HttpApiSchema } from "effect/unstable/httpapi"

export const ServerHandler = HttpApiBuilder.group(Api, "server.server", (handlers) =>
  Effect.gen(function* () {
    const pairing = yield* ServerPairing.Service
    return handlers
      .handle("server.status", () =>
        Effect.gen(function* () {
          const info = yield* ServerInfo.Service
          return {
            version: info.app.version ?? "unknown",
            pid: process.pid ?? 0,
            urls: info.urls(),
          }
        }),
      )
      .handle("server.pairing.status", () =>
        Effect.gen(function* () {
          const info = yield* ServerInfo.Service
          return { urls: info.urls(), tailscale: yield* pairing.status(info.urls()) }
        }),
      )
      .handle("server.pairing.tailscale.enable", () =>
        Effect.gen(function* () {
          const info = yield* ServerInfo.Service
          return { urls: info.urls(), tailscale: yield* pairing.enable(info.urls()) }
        }),
      )
      .handle("server.pairing.tailscale.disable", () =>
        pairing.disable().pipe(Effect.as(HttpApiSchema.NoContent.make())),
      )
  }),
)
