import { expect, test } from "bun:test"
import { SystemPart } from "@Mackery6969/ai/effect"
import { Agent } from "@Mackery6969/core/agent"
import { IdentityPlugin } from "@Mackery6969/core/plugin/identity"
import { Plugin } from "@Mackery6969/core/plugin"
import { PluginHooks } from "@Mackery6969/core/plugin/hooks"
import { PluginHost } from "@Mackery6969/core/plugin/host"
import { Session } from "@Mackery6969/core/session"
import type { SessionHooks } from "@Mackery6969/plugin/effect/session"
import { Model } from "@Mackery6969/schema/model"
import { Provider } from "@Mackery6969/core/provider"
import { Effect } from "effect"
import { testEffect } from "../lib/effect"
import { PluginTestLayer } from "./fixture"

const it = testEffect(PluginTestLayer)

test("formats the model identity part", () => {
  expect(
    IdentityPlugin.identity({
      name: "GPT-4o mini",
      ref: Model.Ref.make({ providerID: Provider.ID.make("openai"), id: Model.ID.make("gpt-4o-mini") }),
    }),
  ).toBe(["# Your Model", "- Name: GPT-4o mini", "- Provider ID: openai", "- Model ID: gpt-4o-mini"].join("\n"))
})

const identity = (name: string, id: string) =>
  ["# Your Model", `- Name: ${name}`, "- Provider ID: test", `- Model ID: ${id}`].join("\n")

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
    const pluginHost = yield* PluginHost.make(plugins, "test")
    yield* catalog.transform((editor) => {
      editor.models.update(Provider.ID.make("test"), Model.ID.make("meta/muse-spark-1.1"), (model) => {
        model.name = "Muse Spark"
      })
    })
    yield* IdentityPlugin.Plugin.effect(pluginHost)

    const named = context("meta/muse-spark-1.1")
    yield* hooks.trigger("session", "context", named)
    expect(named.system.map((part) => part.text)).toEqual([
      "Agent prompt",
      identity("Muse Spark", "meta/muse-spark-1.1"),
      "Initial context",
    ])

    const fallback = context("unknown-model")
    yield* hooks.trigger("session", "context", fallback)
    expect(fallback.system.map((part) => part.text)).toEqual([
      "Agent prompt",
      identity("unknown-model", "unknown-model"),
      "Initial context",
    ])
  }),
)
