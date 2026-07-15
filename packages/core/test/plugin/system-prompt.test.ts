import { describe, expect, test } from "bun:test"
import { SystemPart } from "@opencode-ai/ai"
import { AgentV2 } from "@opencode-ai/core/agent"
import { Catalog } from "@opencode-ai/core/catalog"
import { PluginV2 } from "@opencode-ai/core/plugin"
import { PluginHooks } from "@opencode-ai/core/plugin/hooks"
import { PluginHost } from "@opencode-ai/core/plugin/host"
import { SystemPromptPlugin } from "@opencode-ai/core/plugin/system-prompt"
import { SessionV2 } from "@opencode-ai/core/session"
import type { SessionHooks } from "@opencode-ai/plugin/v2/effect/session"
import { Model } from "@opencode-ai/schema/model"
import { Provider } from "@opencode-ai/schema/provider"
import { Effect } from "effect"
import { testEffect } from "../lib/effect"
import { PluginTestLayer } from "./fixture"
import PROMPT_META from "../../src/plugin/system-prompt/meta.txt"
import PROMPT_DEFAULT from "../../src/session/runner/prompt/base.txt"

const it = testEffect(PluginTestLayer)
const fallback = PROMPT_DEFAULT
const makeHost = Effect.gen(function* () {
  const plugins = yield* PluginV2.Service
  return yield* PluginHost.make(plugins)
})

const context = (id: string, system = fallback): SessionHooks["context"] => ({
  sessionID: SessionV2.ID.make("ses_system_prompt"),
  agent: AgentV2.ID.make("build"),
  model: Model.Ref.make({ providerID: Provider.ID.make("test"), id: Model.ID.make(id) }),
  system: [SystemPart.make(system)],
  messages: [],
  tools: {},
})

describe("SystemPromptPlugin", () => {
  test("uses V2 vocabulary in the Meta prompt", () => {
    expect(PROMPT_META).toContain("webfetch tool")
    expect(PROMPT_META).toContain("subagent tool")
    expect(PROMPT_META).toContain("shell tool")
    expect(PROMPT_META).toContain("read for reading files")
    expect(PROMPT_META).toContain("edit for editing")
    expect(PROMPT_META).toContain("write for creating files")
    expect(PROMPT_META).toContain("https://v2.opencode.ai/llms.txt")
    expect(PROMPT_META).not.toMatch(
      /TodoWrite|Task tool|WebFetch|\bBash\b|Read for reading files|Edit for editing|Write for creating files|https:\/\/opencode\.ai\/docs/,
    )
  })

  test("uses granular IDs with a common prefix", () => {
    expect(SystemPromptPlugin.Plugins.map((plugin) => plugin.id)).toEqual([
      "opencode.system-prompt.openai",
      "opencode.system-prompt.google",
      "opencode.system-prompt.anthropic",
      "opencode.system-prompt.kimi",
      "opencode.system-prompt.arcee",
      "opencode.system-prompt.meta",
    ])
  })

  it.effect("selects model-lab prompts through session context hooks", () =>
    Effect.gen(function* () {
      const hooks = yield* PluginHooks.Service
      const pluginHost = yield* makeHost
      yield* Effect.forEach(SystemPromptPlugin.Plugins, (plugin) => plugin.effect(pluginHost), {
        discard: true,
      })
      const cases = [
        ["gpt-5", "You are OpenCode, You and the user share the same workspace"],
        ["gpt-4.1", "You are OpenCode, You and the user share the same workspace"],
        ["o3", "You are OpenCode, You and the user share the same workspace"],
        ["gpt-5-codex", "## Editing constraints"],
        ["gemini-2.5-pro", "# Core Mandates"],
        ["claude-sonnet-4", "# Professional objectivity"],
        ["kimi-k2", "# Prompt and Tool Use"],
        ["trinity", "what command should I run to list files"],
        ["meta/muse-spark-1.1", "OpenCode powered by Meta Muse Spark"],
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
      const agents = yield* AgentV2.Service
      const hooks = yield* PluginHooks.Service
      yield* agents.transform((draft) =>
        draft.update(AgentV2.ID.make("build"), (agent) => {
          agent.system = "Custom agent prompt"
        }),
      )
      const pluginHost = yield* makeHost
      yield* Effect.forEach(SystemPromptPlugin.Plugins, (plugin) => plugin.effect(pluginHost), {
        discard: true,
      })
      const event = context("gpt-5", "Custom agent prompt")

      yield* hooks.trigger("session", "context", event)

      expect(event.system.map((part) => part.text)).toEqual(["Custom agent prompt"])
    }),
  )

  it.effect("allows one model-lab prompt plugin to be enabled independently", () =>
    Effect.gen(function* () {
      const hooks = yield* PluginHooks.Service
      const pluginHost = yield* makeHost
      yield* SystemPromptPlugin.GooglePlugin.effect(pluginHost)
      const gemini = context("gemini-2.5-pro")
      const claude = context("claude-sonnet-4")

      yield* hooks.trigger("session", "context", gemini)
      yield* hooks.trigger("session", "context", claude)

      expect(gemini.system[0]?.text).toContain("# Core Mandates")
      expect(claude.system[0]?.text).toBe(fallback)
    }),
  )

  it.effect("selects against the catalog model ID instead of its alias", () =>
    Effect.gen(function* () {
      const catalog = yield* Catalog.Service
      const hooks = yield* PluginHooks.Service
      const pluginHost = yield* makeHost
      yield* catalog.transform((draft) => {
        draft.model.update(Provider.ID.make("test"), Model.ID.make("openai-alias"), (model) => {
          model.modelID = Model.ID.make("gpt-5")
        })
        draft.model.update(Provider.ID.make("test"), Model.ID.make("gpt-5-alias"), (model) => {
          model.modelID = Model.ID.make("custom-model")
        })
        draft.model.update(Provider.ID.make("test"), Model.ID.make("codex-family-alias"), (model) => {
          model.modelID = Model.ID.make("custom-deployment")
          model.family = Model.Family.make("gpt-codex")
        })
      })
      yield* SystemPromptPlugin.OpenAIPlugin.effect(pluginHost)
      const physicalOpenAI = context("openai-alias")
      const physicalCustom = context("gpt-5-alias")
      const familyOpenAI = context("codex-family-alias")

      yield* hooks.trigger("session", "context", physicalOpenAI)
      yield* hooks.trigger("session", "context", physicalCustom)
      yield* hooks.trigger("session", "context", familyOpenAI)

      expect(physicalOpenAI.system[0]?.text).toContain("You are OpenCode, You and the user share the same workspace")
      expect(physicalCustom.system[0]?.text).toBe(fallback)
      expect(familyOpenAI.system[0]?.text).toContain("## Editing constraints")
    }),
  )
})
