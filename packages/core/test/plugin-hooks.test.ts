import { describe, expect } from "bun:test"
import { Message, SystemPart } from "@opencode-ai/ai"
import { Agent } from "@opencode-ai/schema/agent"
import { Model } from "@opencode-ai/schema/model"
import { Provider } from "@opencode-ai/schema/provider"
import { Session } from "@opencode-ai/schema/session"
import { Effect, Layer } from "effect"
import { PluginHooks } from "../src/plugin/hooks"
import { testEffect } from "./lib/effect"

const layer = PluginHooks.node.implementation as Layer.Layer<PluginHooks.Service>
const it = testEffect(layer)

describe("PluginHooks", () => {
  it.effect("registers scoped session hooks and triggers them sequentially", () =>
    Effect.gen(function* () {
      const hooks = yield* PluginHooks.Service
      const seen: string[] = []
      yield* hooks.register("session", "context", (event) =>
        Effect.sync(() => {
          seen.push("first")
          event.system.push(SystemPart.make("second"))
        }),
      )
      yield* hooks.register("session", "context", (event) =>
        Effect.sync(() => {
          seen.push(event.system[1]?.text ?? "missing")
          event.messages = [Message.user("changed")]
        }),
      )
      const event = {
        sessionID: Session.ID.make("ses_hooks"),
        agent: Agent.ID.make("build"),
        model: Model.Ref.make({ providerID: Provider.ID.make("test"), id: Model.ID.make("model") }),
        system: [SystemPart.make("first")],
        messages: [Message.user("original")],
        tools: {},
      }

      expect(yield* hooks.trigger("session", "context", event)).toBe(event)
      expect(seen).toEqual(["first", "second"])
      expect(event.messages).toEqual([Message.user("changed")])
    }),
  )
})
