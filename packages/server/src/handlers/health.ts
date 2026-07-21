import { InstallationVersion } from "@opencode-ai/util/installation/version"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { Api } from "../api"

export const HealthHandler = HttpApiBuilder.group(Api, "server.health", (handlers) =>
  handlers
    .handle("health.get", () =>
      Effect.succeed({
        healthy: true as const,
        version: InstallationVersion,
        pid: process.pid,
      }),
    )
    .handle("health.stop", () => Effect.succeed({ accepted: false })),
)
