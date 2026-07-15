import { describe, expect } from "bun:test"
import { SystemPart } from "@opencode-ai/ai"
import { AgentV2 } from "@opencode-ai/core/agent"
import { PluginHooks } from "@opencode-ai/core/plugin/hooks"
import { SystemPromptPlugin } from "@opencode-ai/core/plugin/system-prompt"
import { SessionV2 } from "@opencode-ai/core/session"
import type { SessionHooks } from "@opencode-ai/plugin/v2/effect/session"
import { Model } from "@opencode-ai/schema/model"
import { Provider } from "@opencode-ai/schema/provider"
import { Effect, Layer } from "effect"
import { testEffect } from "../lib/effect"
import { host } from "./host"
import PROMPT_DEFAULT from "../../src/session/runner/prompt/default.txt"

const layer = PluginHooks.node.implementation as Layer.Layer<PluginHooks.Service>
const it = testEffect(layer)
const fallback = PROMPT_DEFAULT

const context = (id: string, system = fallback): SessionHooks["context"] => ({
  sessionID: SessionV2.ID.make("ses_system_prompt"),
  agent: AgentV2.ID.make("build"),
  model: Model.Ref.make({ providerID: Provider.ID.make("test"), id: Model.ID.make(id) }),
  system: [SystemPart.make(system)],
  messages: [],
  tools: {},
})

describe("SystemPromptPlugin", () => {
  it.effect("selects model-family prompts through the session context hook", () =>
    Effect.gen(function* () {
      const hooks = yield* PluginHooks.Service
      yield* SystemPromptPlugin.Plugin.effect(
        host({ session: { hook: (name, callback) => hooks.register("session", name, callback) } }),
      )
      const cases = [
        ["gpt-5", "You are OpenCode, You and the user share the same workspace"],
        ["gpt-4.1", "THE PROBLEM CAN NOT BE SOLVED WITHOUT EXTENSIVE INTERNET RESEARCH"],
        ["o3", "THE PROBLEM CAN NOT BE SOLVED WITHOUT EXTENSIVE INTERNET RESEARCH"],
        ["gpt-5-codex", "## Editing constraints"],
        ["gemini-2.5-pro", "# Core Mandates"],
        ["claude-sonnet-4", "# Professional objectivity"],
        ["kimi-k2", "# Prompt and Tool Use"],
        ["trinity", "what command should I run to list files"],
        ["llama-3.3", "You are opencode, an interactive CLI tool"],
      ] as const

      yield* Effect.forEach(
        cases,
        ([id, expected]) => {
          const event = context(id)
          return hooks
            .trigger("session", "context", event)
            .pipe(Effect.tap(() => Effect.sync(() => expect(event.system[0]?.text).toContain(expected))))
        },
        { discard: true },
      )
    }),
  )

  it.effect("preserves an explicit agent system prompt", () =>
    Effect.gen(function* () {
      const hooks = yield* PluginHooks.Service
      yield* SystemPromptPlugin.Plugin.effect(
        host({ session: { hook: (name, callback) => hooks.register("session", name, callback) } }),
      )
      const event = context("gpt-5", "Custom agent prompt")

      yield* hooks.trigger("session", "context", event)

      expect(event.system.map((part) => part.text)).toEqual(["Custom agent prompt"])
    }),
  )
})
