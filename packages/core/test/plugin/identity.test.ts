import { expect, test } from "bun:test"
import { SystemPart } from "@opencode/ai"
import { Agent } from "@opencode/core/agent"
import { IdentityPlugin } from "@opencode/core/plugin/identity"
import { Plugin } from "@opencode/core/plugin"
import { PluginHooks } from "@opencode/core/plugin/hooks"
import { PluginHost } from "@opencode/core/plugin/host"
import { Session } from "@opencode/core/session"
import type { SessionHooks } from "@opencode/plugin/effect/session"
import { Model } from "@opencode/schema/model"
import { Provider } from "@opencode/core/provider"
import { Effect } from "effect"
import { testEffect } from "../lib/effect"
import { PluginTestLayer } from "./fixture"

const it = testEffect(PluginTestLayer)

test("formats the model identity part", () => {
  expect(
    IdentityPlugin.identity({
      provider: "OpenAI",
      name: "GPT-4o mini",
      ref: Model.Ref.make({ providerID: Provider.ID.make("openai"), id: Model.ID.make("gpt-4o-mini") }),
    }),
  ).toBe(["# Your Model", "- Provider: OpenAI", "- Name: GPT-4o mini", "- ID: openai/gpt-4o-mini"].join("\n"))
})

const identity = (provider: string, name: string, id: string) =>
  ["# Your Model", `- Provider: ${provider}`, `- Name: ${name}`, `- ID: test/${id}`].join("\n")

const context = (id: string): SessionHooks["context"] => ({
  sessionID: Session.ID.make("ses_model_identity"),
  agent: Agent.ID.make("build"),
  model: Model.Ref.make({ providerID: Provider.ID.make("test"), id: Model.ID.make(id) }),
  system: [SystemPart.make("Agent prompt"), SystemPart.make("Initial context")],
  messages: [],
  tools: {},
  options: {},
})

it.effect("inserts the structured model block after the agent prompt", () =>
  Effect.gen(function* () {
    const catalog = yield* Provider.Service
    const hooks = yield* PluginHooks.Service
    const plugins = yield* Plugin.Service
    const pluginHost = yield* PluginHost.make(plugins)
    yield* catalog.transform((editor) => {
      editor.update(Provider.ID.make("test"), (provider) => {
        provider.name = "Test Provider"
      })
      editor.models.update(Provider.ID.make("test"), Model.ID.make("meta/muse-spark-1.1"), (model) => {
        model.name = "Muse Spark"
      })
    })
    yield* IdentityPlugin.Plugin.effect(pluginHost)

    const named = context("meta/muse-spark-1.1")
    yield* hooks.trigger("session", "context", named)
    expect(named.system.map((part) => part.text)).toEqual([
      "Agent prompt",
      identity("Test Provider", "Muse Spark", "meta/muse-spark-1.1"),
      "Initial context",
    ])

    const fallback = context("unknown-model")
    yield* hooks.trigger("session", "context", fallback)
    expect(fallback.system.map((part) => part.text)).toEqual([
      "Agent prompt",
      identity("Test Provider", "unknown-model", "unknown-model"),
      "Initial context",
    ])
  }),
)
