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
          // Runtimes without OS process identity (workerd) report 0.
          pid: process.pid ?? 0,
        }
      }),
    )
    .handle("health.stop", () => Effect.succeed({ accepted: false })),
)
