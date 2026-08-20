import { describe, expect } from "bun:test"
import { Message } from "@opencode-ai/ai"
import { Agent } from "@opencode-ai/core/agent"
import { Config } from "@opencode-ai/core/config"
import { Model } from "@opencode-ai/core/model"
import { PluginHooks } from "@opencode-ai/core/plugin/hooks"
import { Provider } from "@opencode-ai/core/provider"
import { Session } from "@opencode-ai/core/session"
import { Effect, Stream } from "effect"
import { TestClock } from "effect/testing"
import { Config as ConfigSchema } from "@opencode-ai/schema/config"
import { WarmingPlugin } from "../../src/plugin/warming"
import { testEffect } from "../lib/effect"
import { PluginTestLayer } from "./fixture"
import { host } from "./host"

const it = testEffect(PluginTestLayer)

describe("warming plugin", () => {
  it.effect("uses the 150-second default interval", () =>
    Effect.gen(function* () {
      const hooks = yield* PluginHooks.Service
      const generated: string[] = []
      const sessionID = Session.ID.make("ses_warming_default")
      const config = Config.Service.of({
        entries: () =>
          Effect.succeed([
            new ConfigSchema.Document({
              type: "document",
              info: new ConfigSchema.Info({ warming: true }),
            }),
          ]),
        update: () => Effect.die("unused config.update"),
        changes: () => Stream.empty,
      })

      yield* WarmingPlugin.Plugin.effect(
        host({
          session: {
            hook: (name, callback, options) => hooks.register("session", name, callback, options),
            generate: (input) => Effect.sync(() => generated.push(input.prompt)).pipe(Effect.as({ text: "OK" })),
          },
        }),
      ).pipe(Effect.provideService(Config.Service, config))
      yield* hooks.trigger("session", "context", {
        sessionID,
        agent: Agent.ID.make("build"),
        model: Model.Ref.make({ providerID: Provider.ID.make("test"), id: Model.ID.make("model") }),
        system: [],
        messages: [Message.user("Hello")],
        tools: {},
      })

      yield* TestClock.adjust("149 seconds")
      expect(generated).toEqual([])
      yield* TestClock.adjust("1 second")
      expect(generated).toEqual([
        "This is a keep-alive request. Do not perform any work or use tools. Reply with exactly: OK",
      ])
    }),
  )
})
