import { Capability } from "@opencode-ai/core/capability"
import { Skill } from "@opencode-ai/core/skill"
import { Effect } from "effect"
import { HttpApiBuilder, HttpApiSchema } from "effect/unstable/httpapi"
import { Api } from "../api"
import { response } from "../location"

export const CapabilityHandler = HttpApiBuilder.group(Api, "server.capability", (handlers) =>
  handlers
    .handle(
      "capability.list",
      Effect.fn(function* () {
        const capability = yield* Capability.Service
        const skills = yield* Skill.Service
        const info = yield* Effect.forEach(yield* skills.list(), (item) =>
          Effect.gen(function* () {
            const ref = Capability.skill(item.id)
            const preference = yield* capability.get(ref)
            return Capability.Info.make({
              ref,
              name: item.name,
              description: item.description,
              defaultState: item.autoinvoke === false ? "disabled" : "enabled",
              preference,
              state: yield* capability.resolve(ref, item.autoinvoke !== false),
            })
          }),
        )
        return yield* response(Effect.succeed(info))
      }),
    )
    .handle(
      "capability.update",
      Effect.fn(function* (ctx) {
        const capability = yield* Capability.Service
        yield* capability.set(ctx.payload)
        return HttpApiSchema.NoContent.make()
      }),
    ),
)
