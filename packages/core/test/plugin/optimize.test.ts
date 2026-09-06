import { describe, expect, test } from "bun:test"
import { SystemPart } from "@opencode-ai/ai"
import { Agent } from "@opencode-ai/core/agent"
import { Catalog } from "@opencode-ai/core/catalog"
import { Plugin } from "@opencode-ai/core/plugin"
import { PluginHooks } from "@opencode-ai/core/plugin/hooks"
import { PluginHost } from "@opencode-ai/core/plugin/host"
import { OptimizePlugin } from "@opencode-ai/core/plugin/optimize"
import { Session } from "@opencode-ai/core/session"
import { SessionSystemPrompt } from "@opencode-ai/core/session/system-prompt"
import type { SessionHooks } from "@opencode-ai/plugin/effect/session"
import { Model } from "@opencode-ai/schema/model"
import { Provider } from "@opencode-ai/schema/provider"
import { Effect } from "effect"
import { testEffect } from "../lib/effect"
import { PluginTestLayer } from "./fixture"
import PROMPT_META from "../../src/plugin/system-prompt/meta.txt"

const it = testEffect(PluginTestLayer)
const fallback = SessionSystemPrompt.make([])
const makeHost = Effect.gen(function* () {
  const agents = yield* Agent.Service
  const plugins = yield* Plugin.Service
  yield* agents.transform((editor) => editor.update(Agent.ID.make("build"), () => {}))
  return yield* PluginHost.make(plugins)
})

const context = (id: string, system = fallback): SessionHooks["context"] => ({
  sessionID: Session.ID.make("ses_model_optimization"),
  agent: Agent.ID.make("build"),
  model: Model.Ref.make({ providerID: Provider.ID.make("test"), id: Model.ID.make(id) }),
  system: [SystemPart.make(system)],
  messages: [],
  tools: Object.fromEntries(
    ["shell", "read", "grep", "glob", "edit", "write", "patch"].map((name) => [
      name,
      { description: name, input: { type: "object" } },
    ]),
  ),
  generation: {},
  providerOptions: {},
})

describe("OptimizePlugin", () => {
  test("uses current vocabulary in the Meta prompt", () => {
    expect(PROMPT_META).toContain("`webfetch` tool")
    expect(PROMPT_META).toContain("`subagent` tool")
    expect(PROMPT_META).toContain("Reserve `shell`")
    expect(PROMPT_META).toContain("`read` for reading files")
    expect(PROMPT_META).toContain("`edit` for editing")
    expect(PROMPT_META).toContain("`write` for creating files")
    expect(PROMPT_META).toContain("Follow that reminder for the files you may edit")
    expect(PROMPT_META).toContain("https://opencode.ai/v2/docs/")
    expect(PROMPT_META).not.toMatch(
      /TodoWrite|Task tool|WebFetch|\bBash\b|including planning files|https:\/\/opencode\.ai\/docs/,
    )
  })

  test("enables prompt plugins without model-specific tool optimization", () => {
    expect(OptimizePlugin.Plugins.map((plugin) => plugin.id)).toEqual([
      "opencode.prompt.openai",
      "opencode.prompt.kimi",
      "opencode.prompt.arcee",
      "opencode.prompt.meta",
    ])
  })

  it.effect("selects model-lab prompts through session context hooks", () =>
    Effect.gen(function* () {
      const catalog = yield* Catalog.Service
      const hooks = yield* PluginHooks.Service
      const pluginHost = yield* makeHost
      yield* catalog.transform((editor) => {
        for (const id of ["gpt-5", "gpt-4.1", "gpt-5-codex", "gpt-6-astra"])
          editor.model.update(Provider.ID.make("test"), Model.ID.make(id), () => {})
        editor.model.update(Provider.ID.make("test"), Model.ID.make("meta/muse-spark-1.1"), (model) => {
          model.name = "Muse Spark"
        })
      })
      yield* Effect.forEach(OptimizePlugin.Plugins, (plugin) => plugin.effect(pluginHost), {
        discard: true,
      })
      const cases = [
        ["gpt-5", "# Delegation"],
        ["gpt-4.1", "# Delegation"],
        ["o3", fallback],
        ["gpt-5-codex", "# Delegation"],
        ["gpt-6-astra", "Do not settle for a partial"],
        ["gemini-2.5-pro", fallback],
        ["claude-sonnet-4", fallback],
        ["kimi-k2", "# Prompt and Tool Use"],
        ["trinity", "what command should I run to list files"],
        ["meta/muse-spark-1.1", "powered by Muse Spark"],
        ["llama-3.3", fallback],
      ] as const

      yield* Effect.forEach(
        cases,
        ([id, expected]) => {
          const event = context(id)
          return hooks
            .trigger("session", "context", event)
            .pipe(
              Effect.tap(() =>
                Effect.sync(() => expect(event.system.map((part) => part.text).join("\n\n")).toContain(expected)),
              ),
            )
        },
        { discard: true },
      )
    }),
  )

  it.effect("renders the OpenAI prompt without changing tools or project instructions", () =>
    Effect.gen(function* () {
      const catalog = yield* Catalog.Service
      const hooks = yield* PluginHooks.Service
      const pluginHost = yield* makeHost
      yield* catalog.transform((editor) =>
        editor.model.update(Provider.ID.make("test"), Model.ID.make("gpt-5"), () => {}),
      )
      yield* OptimizePlugin.OpenAIPlugin.effect(pluginHost)
      const event = context("gpt-5")
      event.system.push(SystemPart.make("Project instructions"))
      event.tools.shell = { description: "Run a command", input: { type: "object" } }

      yield* hooks.trigger("session", "context", event)

      expect(event.system.map((part) => part.text)).toEqual([
        expect.stringContaining("# Delegation"),
        "Project instructions",
      ])
      expect(event.system[0]?.text).toStartWith("You are an AI agent powered by OpenCode")
      expect(event.system[0]?.text).toContain("Prefer dedicated tools over shell commands")
      expect(event.system[0]?.text).not.toContain("${OPENCODE_TOOL_GUIDANCE}")
      expect(event.system[0]?.text).toContain("Use the write tool")
      expect(event.system[0]?.text).toContain("Use the edit tool")
      expect(Object.keys(event.tools).sort()).toEqual(["edit", "glob", "grep", "patch", "read", "shell", "write"])
    }),
  )

  it.effect("curates search tools across providers without changing editing tools", () =>
    Effect.gen(function* () {
      const hooks = yield* PluginHooks.Service
      const pluginHost = yield* makeHost
      yield* OptimizePlugin.OpenAIToolsPlugin.effect(pluginHost)
      yield* OptimizePlugin.AnthropicToolsPlugin.effect(pluginHost)
      const cases = [
        ["openai", "gpt-5", ["edit", "patch", "read", "shell", "write"]],
        ["openrouter", "openai/gpt-6-astra", ["edit", "patch", "read", "shell", "write"]],
        ["azure", "GPT-4.1", ["edit", "patch", "read", "shell", "write"]],
        ["groq", "openai/gpt-oss-120b", ["edit", "patch", "read", "shell", "write"]],
        ["anthropic", "claude-opus-4-8", ["edit", "patch", "read", "shell", "write"]],
        ["amazon-bedrock", "us.anthropic.Claude-sonnet-4-6", ["edit", "patch", "read", "shell", "write"]],
        ["github-copilot", "claude-sonnet-4.6", ["edit", "patch", "read", "shell", "write"]],
        ["google", "gemini-2.5-pro", ["edit", "glob", "grep", "patch", "read", "shell", "write"]],
        ["moonshotai", "kimi-k2", ["edit", "glob", "grep", "patch", "read", "shell", "write"]],
        ["openai", "o3", ["edit", "glob", "grep", "patch", "read", "shell", "write"]],
        ["anthropic", "other-model", ["edit", "glob", "grep", "patch", "read", "shell", "write"]],
      ] as const

      yield* Effect.forEach(
        cases,
        ([providerID, id, tools]) =>
          Effect.gen(function* () {
            const event = {
              ...context(id),
              model: Model.Ref.make({ providerID: Provider.ID.make(providerID), id: Model.ID.make(id) }),
            }
            yield* hooks.trigger("session", "context", event)
            expect(Object.keys(event.tools).sort()).toEqual([...tools])
            expect(event.system.map((part) => part.text)).toEqual([fallback])
          }),
        { discard: true },
      )
    }),
  )

  it.effect("can disable OpenAI tool optimization while retaining its prompt and Anthropic tool optimization", () =>
    Effect.gen(function* () {
      const hooks = yield* PluginHooks.Service
      const pluginHost = yield* makeHost
      yield* OptimizePlugin.OpenAIPlugin.effect(pluginHost)
      yield* OptimizePlugin.AnthropicToolsPlugin.effect(pluginHost)
      yield* Effect.scoped(
        Effect.gen(function* () {
          yield* OptimizePlugin.OpenAIToolsPlugin.effect(pluginHost)
          const event = context("gpt-5")
          yield* hooks.trigger("session", "context", event)
          expect(event.system[0]?.text).toContain("# Delegation")
          expect(Object.keys(event.tools).sort()).toEqual(["edit", "patch", "read", "shell", "write"])
        }),
      )

      const event = context("gpt-5")
      yield* hooks.trigger("session", "context", event)
      expect(event.system[0]?.text).toContain("# Delegation")
      expect(Object.keys(event.tools).sort()).toEqual(["edit", "glob", "grep", "patch", "read", "shell", "write"])
      const claude = context("claude-sonnet-4-6")
      yield* hooks.trigger("session", "context", claude)
      expect(claude.system.map((part) => part.text)).toEqual([fallback])
      expect(Object.keys(claude.tools).sort()).toEqual(["edit", "patch", "read", "shell", "write"])
    }),
  )

  it.effect("uses catalog names in Meta prompts for Muse model IDs", () =>
    Effect.gen(function* () {
      const catalog = yield* Catalog.Service
      const hooks = yield* PluginHooks.Service
      const pluginHost = yield* makeHost
      const cases = [
        ["meta/muse-spark-preview", "Muse Spark Preview"],
        ["muse-spark-1.2", "Muse Spark 1.2"],
        ["meta/muse-glimmer-30b", "Muse Glimmer 30B"],
        ["muse-glimmer-30b", "Muse Glimmer"],
      ] as const
      yield* catalog.transform((editor) => {
        for (const [id, name] of cases)
          editor.model.update(Provider.ID.make("test"), Model.ID.make(id), (model) => {
            model.name = name
          })
      })
      yield* OptimizePlugin.MetaPlugin.effect(pluginHost)

      yield* Effect.forEach(
        cases,
        ([id, name]) => {
          const event = context(id)
          return hooks.trigger("session", "context", event).pipe(
            Effect.tap(() =>
              Effect.sync(() => {
                expect(event.system[0]?.text).toContain(`powered by ${name},`)
                expect(event.system[0]?.text).toContain(`using Meta ${name}.`)
                expect(event.system[0]?.text).not.toContain("{{MODEL_NAME}}")
              }),
            ),
          )
        },
        { discard: true },
      )
    }),
  )

  it.effect("preserves tools and an explicit agent system prompt by default", () =>
    Effect.gen(function* () {
      const agents = yield* Agent.Service
      const hooks = yield* PluginHooks.Service
      yield* agents.transform((editor) =>
        editor.update(Agent.ID.make("build"), (agent) => {
          agent.system = "Custom agent prompt"
        }),
      )
      const pluginHost = yield* makeHost
      yield* Effect.forEach(OptimizePlugin.Plugins, (plugin) => plugin.effect(pluginHost), {
        discard: true,
      })
      const event = context("gpt-5", "Custom agent prompt")

      yield* hooks.trigger("session", "context", event)

      expect(event.system.map((part) => part.text)).toEqual(["Custom agent prompt"])
      expect(Object.keys(event.tools).sort()).toEqual(["edit", "glob", "grep", "patch", "read", "shell", "write"])
    }),
  )

  it.effect("still curates tools when agent lookup fails", () =>
    Effect.gen(function* () {
      const agents = yield* Agent.Service
      const hooks = yield* PluginHooks.Service
      const pluginHost = yield* makeHost
      yield* OptimizePlugin.OpenAIPlugin.effect(pluginHost)
      yield* OptimizePlugin.OpenAIToolsPlugin.effect(pluginHost)
      yield* agents.transform((editor) => editor.remove(Agent.ID.make("build")))
      const event = context("gpt-5")

      yield* hooks.trigger("session", "context", event)

      expect(event.system.map((part) => part.text)).toEqual([fallback])
      expect(Object.keys(event.tools).sort()).toEqual(["edit", "patch", "read", "shell", "write"])
    }),
  )

  it.effect("allows one model-lab optimization plugin to be enabled independently", () =>
    Effect.gen(function* () {
      const hooks = yield* PluginHooks.Service
      const pluginHost = yield* makeHost
      yield* OptimizePlugin.KimiPlugin.effect(pluginHost)
      const gemini = context("gemini-2.5-pro")
      const kimi = context("kimi-k2")

      yield* hooks.trigger("session", "context", gemini)
      yield* hooks.trigger("session", "context", kimi)

      expect(gemini.system[0]?.text).toBe(fallback)
      expect(kimi.system[0]?.text).toContain("# Prompt and Tool Use")
    }),
  )

  it.effect("preserves tools for model aliases and catalog-ID prompt selection by default", () =>
    Effect.gen(function* () {
      const catalog = yield* Catalog.Service
      const hooks = yield* PluginHooks.Service
      const pluginHost = yield* makeHost
      const cases = [
        ["gpt-5-alias", "custom-model", undefined, "# Delegation"],
        ["gpt-6-alias", "custom-model", undefined, "Do not settle for a partial"],
        ["openai-alias", "GPT-5", undefined, fallback],
        ["codex-family-alias", "custom-deployment", "GPT-CODEX", fallback],
        ["astra-api-alias", "gpt-6-astra", undefined, fallback],
        ["astra-family-alias", "custom-deployment", "gpt-6", fallback],
        ["claude-catalog-alias", "custom-model", undefined, fallback],
        ["anthropic-api-alias", "Claude-Opus-4-8", undefined, fallback],
        ["anthropic-family-alias", "custom-deployment", "CLAUDE-SONNET", fallback],
      ] as const
      yield* catalog.transform((editor) => {
        for (const [id, modelID, family] of cases)
          editor.model.update(Provider.ID.make("test"), Model.ID.make(id), (model) => {
            model.modelID = Model.ID.make(modelID)
            if (family) model.family = Model.Family.make(family)
          })
      })
      yield* Effect.forEach(OptimizePlugin.Plugins, (plugin) => plugin.effect(pluginHost), { discard: true })
      yield* Effect.forEach(
        cases,
        ([id, , , prompt]) =>
          Effect.gen(function* () {
            const event = context(id)
            yield* hooks.trigger("session", "context", event)
            expect(event.system[0]?.text).toContain(prompt)
            expect(Object.keys(event.tools).sort()).toEqual(["edit", "glob", "grep", "patch", "read", "shell", "write"])
          }),
        { discard: true },
      )
    }),
  )
})
