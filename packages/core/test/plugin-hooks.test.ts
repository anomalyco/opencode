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

  it.effect("mutates shell creation input", () =>
    Effect.gen(function* () {
      const hooks = yield* PluginHooks.Service
      yield* hooks.register("shell", "create.before", (event) =>
        Effect.sync(() => {
          event.command = "echo changed"
        }),
      )
      const event = {
        command: "echo original",
        cwd: "/tmp",
        timeout: 0,
        shell: "/bin/sh",
        env: {},
      }

      expect(yield* hooks.trigger("shell", "create.before", event)).toBe(event)
      expect(event.command).toBe("echo changed")
    }),
  )

  it.effect("prepares provider models sequentially with provider filtering", () =>
    Effect.gen(function* () {
      const hooks = yield* PluginHooks.Service
      yield* hooks.register(
        "provider",
        "model.prepare",
        (event) =>
          Effect.sync(() => {
            event.modelID = `prepared-${event.modelID}`
            event.settings.first = true
          }),
        { providerID: Provider.ID.make("test") },
      )
      yield* hooks.register("provider", "model.prepare", (event) =>
        Effect.sync(() => {
          event.settings.seen = event.modelID
        }),
      )
      const model = Model.Info.default(Provider.ID.make("test"), Model.ID.make("model"))
      const event = {
        model,
        package: "test-provider",
        modelID: String(model.modelID),
        settings: {},
      }

      expect(yield* hooks.trigger("provider", "model.prepare", event)).toBe(event)
      expect(event).toMatchObject({
        modelID: "prepared-model",
        settings: { first: true, seen: "prepared-model" },
      })
    }),
  )
})
