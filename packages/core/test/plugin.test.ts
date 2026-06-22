import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { define } from "@opencode-ai/plugin/v2/effect"
import { AgentV2 } from "@opencode-ai/core/agent"
import { PluginV2 } from "@opencode-ai/core/plugin"
import { testEffect } from "./lib/effect"
import { PluginTestLayer } from "./plugin/fixture"

const it = testEffect(PluginTestLayer)

describe("PluginV2", () => {
  it.effect("reconciles transformed plugins", () =>
    Effect.gen(function* () {
      const plugins = yield* PluginV2.Service
      const agents = yield* AgentV2.Service
      let description = "first"

      const registration = yield* plugins.transform((draft) => {
        draft.add(
          define({
            id: "managed",
            effect: (ctx) =>
              ctx.agent
                .transform((agents) =>
                  agents.update("configured", (agent) => {
                    agent.description = description
                  }),
                )
                .pipe(Effect.asVoid),
          }),
        )
      })

      expect((yield* agents.get(AgentV2.ID.make("configured")))?.description).toBe("first")

      description = "second"
      yield* plugins.reload()
      expect((yield* agents.get(AgentV2.ID.make("configured")))?.description).toBe("second")

      yield* registration.dispose
      expect(yield* agents.get(AgentV2.ID.make("configured"))).toBeUndefined()
    }),
  )
})
