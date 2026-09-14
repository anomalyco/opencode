import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { Api } from "../api"
import { ServerInfo } from "../server-info"

export const ServerHandler = HttpApiBuilder.group(Api, "server.server", (handlers) =>
  handlers.handle("server.status", () =>
    Effect.gen(function* () {
      const info = yield* ServerInfo.Service
      return {
        version: info.app.version ?? "unknown",
        pid: process.pid ?? 0,
        urls: info.urls(),
      }
    }),
  ),
)
