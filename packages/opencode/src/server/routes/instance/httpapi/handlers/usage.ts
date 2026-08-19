import { Usage } from "@/usage/usage"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { InstanceHttpApi } from "../api"
import { UsageQuerySchema } from "../groups/usage"

export const usageHandlers = HttpApiBuilder.group(InstanceHttpApi, "usage", (handlers) =>
  Effect.gen(function* () {
    const usage = yield* Usage.Service

    const get = Effect.fn("UsageHttpApi.get")(function* (ctx: { query: typeof UsageQuerySchema.Type }) {
      return yield* usage.getResponse(ctx.query).pipe(Effect.orDie)
    })

    return handlers.handle("get", get)
  }),
)
