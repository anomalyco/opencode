import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { V2Api } from "../../api"

export const healthHandlers = HttpApiBuilder.group(V2Api, "v2.health", (handlers) =>
  handlers.handle("health", () => Effect.succeed({ healthy: true as const })),
)
