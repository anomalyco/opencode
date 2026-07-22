import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { Api } from "../api"
import { ServerInfo } from "../server-info"

export const HealthHandler = HttpApiBuilder.group(Api, "server.health", (handlers) =>
  handlers
    .handle("health.get", () =>
      Effect.gen(function* () {
        const info = yield* ServerInfo.Service
        return {
          healthy: true as const,
          version: info.app.version ?? "unknown",
          pid: process.pid,
        }
      }),
    )
    .handle("health.stop", () => Effect.succeed({ accepted: false })),
)
