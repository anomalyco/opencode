import { describe, expect, test } from "bun:test"
import { Message, SystemPart } from "@opencode-ai/ai"
import { Agent } from "@opencode-ai/core/agent"
import { Catalog } from "@opencode-ai/core/catalog"
import { Plugin } from "@opencode-ai/core/plugin"
import { PluginHooks } from "@opencode-ai/core/plugin/hooks"
import { PluginHost } from "@opencode-ai/core/plugin/host"
import { SystemPromptPlugin } from "@opencode-ai/core/plugin/system-prompt"
import { UltraPlugin } from "@opencode-ai/core/plugin/ultra"
import { Session } from "@opencode-ai/core/session"
import { SessionEvent } from "@opencode-ai/core/session/event"
import { SessionInbox } from "@opencode-ai/core/session/inbox"
import { SessionMessage } from "@opencode-ai/core/session/message"
import { SessionSystemPrompt } from "@opencode-ai/core/session/system-prompt"
import type { SessionHooks } from "@opencode-ai/plugin/effect/session"
import { Event } from "@opencode-ai/schema/event"
import { Model } from "@opencode-ai/schema/model"
import { Provider } from "@opencode-ai/schema/provider"
import { DateTime, Effect, Stream } from "effect"
import { testEffect } from "../lib/effect"
import { PluginTestLayer } from "./fixture"
import { catalogHost, host } from "./host"
import PROMPT_META from "../../src/plugin/system-prompt/meta.txt"

const it = testEffect(PluginTestLayer)
const fallback = SessionSystemPrompt.make([])
const sessionID = Session.ID.make("ses_system_prompt")
const makeHost = Effect.gen(function* () {
  const agents = yield* Agent.Service
  const plugins = yield* Plugin.Service
  yield* agents.transform((draft) => draft.update(Agent.ID.make("build"), () => {}))
  return yield* PluginHost.make(plugins)
})

const context = (
  id: string,
  system = fallback,
  variant?: string,
  providerID = Provider.ID.make("test"),
): SessionHooks["context"] => ({
  sessionID,
  agent: Agent.ID.make("build"),
  model: Model.Ref.make({
    providerID,
    id: Model.ID.make(id),
    ...(variant ? { variant: Model.VariantID.make(variant) } : {}),
  }),
  system: [SystemPart.make(system)],
  messages: [],
  tools: {},
  generation: {},
  providerOptions: {},
})

const modelSelected = (model: Model.Ref, previous: Model.Ref): SessionEvent.ModelSelected => ({
  id: Event.ID.create(),
  created: 0,
  durable: { aggregateID: sessionID, seq: Event.Seq.make(0), version: Event.Version.make(1) },
  type: "session.model.selected",
  data: { sessionID, model, previous },
})

const settle = (values: ReadonlyArray<string>, expected: number, remaining = 1000): Effect.Effect<void, Error> =>
  Effect.gen(function* () {
    if (values.length >= expected) return
    if (remaining === 0) return yield* Effect.fail(new Error(`Timed out waiting for ${expected} reminders`))
    yield* Effect.promise(() => Bun.sleep(1))
    yield* settle(values, expected, remaining - 1)
  })

describe("SystemPromptPlugin", () => {
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

  test("uses granular IDs with a common prefix", () => {
    expect(SystemPromptPlugin.Plugins.map((plugin) => plugin.id)).toEqual([
      "opencode.prompt.openai",
      "opencode.prompt.anthropic",
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
      yield* catalog.transform((draft) => {
        for (const id of ["gpt-5", "gpt-4.1", "o3", "gpt-5-codex"])
          draft.model.update(Provider.ID.make("test"), Model.ID.make(id), () => {})
      })
      yield* Effect.forEach(SystemPromptPlugin.Plugins, (plugin) => plugin.effect(pluginHost), {
        discard: true,
      })
      const cases = [
        ["gpt-5", "Work as a pragmatic, effective senior software engineer"],
        ["gpt-4.1", "Work as a pragmatic, effective senior software engineer"],
        ["o3", "Work as a pragmatic, effective senior software engineer"],
        ["gpt-5-codex", "Work as a pragmatic, effective senior software engineer"],
        ["gemini-2.5-pro", fallback],
        ["claude-sonnet-4", "# Professional objectivity"],
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

  it.effect("keeps the OpenAI prefix stable and reconciles Ultra mode reminders", () =>
    Effect.gen(function* () {
      const catalog = yield* Catalog.Service
      const hooks = yield* PluginHooks.Service
      const pluginHost = yield* makeHost
      yield* catalog.transform((draft) => {
        draft.provider.update(Provider.ID.openai, () => {})
        draft.model.update(Provider.ID.openai, Model.ID.make("gpt-5.6-sol"), (model) => {
          model.variants = [{ id: Model.VariantID.make("max"), settings: { reasoningEffort: "max" } }]
        })
        draft.model.update(Provider.ID.openai, Model.ID.make("gpt-5.6-luna"), () => {})
      })
      yield* SystemPromptPlugin.OpenAIPlugin.effect(pluginHost)
      yield* UltraPlugin.Plugin.effect(pluginHost)
      const normal = context("gpt-5.6-sol", fallback, undefined, Provider.ID.openai)
      const ultra = context("gpt-5.6-sol", fallback, "ultra", Provider.ID.openai)
      const unsupported = context("gpt-5.6-luna", fallback, "ultra", Provider.ID.openai)

      yield* hooks.trigger("session", "context", normal)
      yield* hooks.trigger("session", "context", ultra)
      yield* hooks.trigger("session", "context", unsupported)

      expect(normal.system.map((part) => part.text)).toEqual([
        fallback,
        expect.stringContaining("Work as a pragmatic, effective senior software engineer"),
      ])
      expect(normal.system[1]?.text).toContain("Only delegate work to subagents when the user explicitly asks you to")
      expect(ultra.system).toEqual(normal.system)
      expect(ultra.messages).toHaveLength(1)
      expect(unsupported.messages).toHaveLength(0)
      const enter = ultra.messages[0]?.content[0]
      expect(enter?.type === "text" && enter.text).toContain("Ultra mode is active")

      const leave = context("gpt-5.6-sol", fallback, undefined, Provider.ID.openai)
      leave.messages.push(ultra.messages[0]!, Message.user("continue"))
      yield* hooks.trigger("session", "context", leave)
      expect(leave.messages).toHaveLength(3)
      const exit = leave.messages[1]?.content[0]
      expect(exit?.type === "text" && exit.text).toContain("Ultra mode is no longer active")
    }),
  )

  it.effect("adds Ultra variants to supported GPT-5.6 models across providers", () =>
    Effect.gen(function* () {
      const catalog = yield* Catalog.Service
      const pluginHost = yield* makeHost
      yield* catalog.transform((draft) => {
        draft.provider.update(Provider.ID.openai, () => {})
        draft.model.update(Provider.ID.openai, Model.ID.make("sol-alias"), (model) => {
          model.modelID = Model.ID.make("gpt-5.6-sol")
          model.variants = [
            {
              id: Model.VariantID.make("max"),
              settings: {
                reasoningEffort: "max",
                reasoningSummary: "auto",
                include: ["reasoning.encrypted_content"],
              },
              headers: { "x-reasoning": "max" },
              body: { reasoning: { effort: "max" } },
            },
            {
              id: Model.VariantID.make("ultra"),
              settings: { reasoningEffort: "ultra" },
            },
          ]
        })
        draft.model.update(Provider.ID.openai, Model.ID.make("gpt-5.6-terra"), (model) => {
          model.variants = [{ id: Model.VariantID.make("max"), settings: { maxReasoningEffort: "max" } }]
        })
        draft.model.update(Provider.ID.openai, Model.ID.make("gpt-5.6-luna"), (model) => {
          model.variants = [{ id: Model.VariantID.make("max"), settings: { reasoningEffort: "max" } }]
        })
        draft.model.update(Provider.ID.make("test"), Model.ID.make("gpt-5.6-sol"), (model) => {
          model.variants = [{ id: Model.VariantID.make("max"), settings: { reasoningEffort: "max" } }]
        })
      })
      yield* UltraPlugin.Plugin.effect(pluginHost)

      const sol = yield* catalog.model.get(Provider.ID.openai, Model.ID.make("sol-alias"))
      const terra = yield* catalog.model.get(Provider.ID.openai, Model.ID.make("gpt-5.6-terra"))
      const luna = yield* catalog.model.get(Provider.ID.openai, Model.ID.make("gpt-5.6-luna"))
      const other = yield* catalog.model.get(Provider.ID.make("test"), Model.ID.make("gpt-5.6-sol"))

      expect(sol?.variants.find((variant) => variant.id === "ultra")).toEqual({
        id: Model.VariantID.make("ultra"),
        settings: {
          reasoningEffort: "max",
          reasoningSummary: "auto",
          include: ["reasoning.encrypted_content"],
        },
        headers: { "x-reasoning": "max" },
        body: { reasoning: { effort: "max" } },
      })
      expect(terra?.variants.find((variant) => variant.id === "ultra")).toEqual({
        id: Model.VariantID.make("ultra"),
        settings: { maxReasoningEffort: "max" },
      })
      expect(luna?.variants.find((variant) => variant.id === "ultra")).toBeUndefined()
      expect(other?.variants.find((variant) => variant.id === "ultra")).toEqual({
        id: Model.VariantID.make("ultra"),
        settings: { reasoningEffort: "max" },
      })
    }),
  )

  it.effect("persists Ultra enter and leave reminders on model switches", () =>
    Effect.gen(function* () {
      const catalog = yield* Catalog.Service
      yield* catalog.transform((draft) => {
        draft.provider.update(Provider.ID.make("test"), () => {})
        draft.model.update(Provider.ID.make("test"), Model.ID.make("sol-alias"), (model) => {
          model.modelID = Model.ID.make("gpt-5.6-sol")
          model.variants = [{ id: Model.VariantID.make("max"), settings: { reasoningEffort: "max" } }]
        })
      })
      const normal = Model.Ref.make({ providerID: Provider.ID.make("test"), id: Model.ID.make("sol-alias") })
      const ultra = Model.Ref.make({ ...normal, variant: Model.VariantID.make("ultra") })
      const persisted = new Array<string>()
      yield* UltraPlugin.Plugin.effect(
        host({
          catalog: catalogHost(catalog),
          event: { subscribe: () => Stream.fromIterable([modelSelected(ultra, normal), modelSelected(normal, ultra)]) },
          session: {
            hook: () => Effect.succeed({ dispose: Effect.void }),
            synthetic: (input) => {
              persisted.push(input.text)
              return Effect.succeed(
                SessionInbox.Synthetic.make({
                  id: SessionMessage.ID.make(`msg_ultra_${persisted.length}`),
                  sessionID,
                  timeCreated: DateTime.makeUnsafe(0),
                  type: "synthetic",
                  payload: { text: input.text },
                  delivery: "steer",
                }),
              )
            },
          },
        }),
      )

      yield* settle(persisted, 2)
      expect(persisted[0]).toContain("Ultra mode is active")
      expect(persisted[1]).toContain("Ultra mode is no longer active")
    }),
  )

  it.effect("selects the Meta prompt for Muse family model IDs", () =>
    Effect.gen(function* () {
      const hooks = yield* PluginHooks.Service
      const pluginHost = yield* makeHost
      yield* SystemPromptPlugin.MetaPlugin.effect(pluginHost)

      yield* Effect.forEach(
        [
          ["meta/muse-spark-preview", "Muse Spark"],
          ["muse-spark-1.2", "Muse Spark"],
          ["meta/muse-glimmer-30b", "Muse Glimmer"],
          ["muse-glimmer-30b", "Muse Glimmer"],
        ] as const,
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

  it.effect("preserves an explicit agent system prompt", () =>
    Effect.gen(function* () {
      const agents = yield* Agent.Service
      const hooks = yield* PluginHooks.Service
      yield* agents.transform((draft) =>
        draft.update(Agent.ID.make("build"), (agent) => {
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

  it.effect("skips the hook when agent lookup fails", () =>
    Effect.gen(function* () {
      const agents = yield* Agent.Service
      const hooks = yield* PluginHooks.Service
      const pluginHost = yield* makeHost
      yield* SystemPromptPlugin.OpenAIPlugin.effect(pluginHost)
      yield* agents.transform((draft) => draft.remove(Agent.ID.make("build")))
      const event = context("gpt-5")

      yield* hooks.trigger("session", "context", event)

      expect(event.system[0]?.text).toBe(fallback)
    }),
  )

  it.effect("allows one model-lab prompt plugin to be enabled independently", () =>
    Effect.gen(function* () {
      const hooks = yield* PluginHooks.Service
      const pluginHost = yield* makeHost
      yield* SystemPromptPlugin.AnthropicPlugin.effect(pluginHost)
      const gemini = context("gemini-2.5-pro")
      const claude = context("claude-sonnet-4")

      yield* hooks.trigger("session", "context", gemini)
      yield* hooks.trigger("session", "context", claude)

      expect(gemini.system[0]?.text).toBe(fallback)
      expect(claude.system[0]?.text).toContain("# Professional objectivity")
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

      expect(physicalOpenAI.system.map((part) => part.text).join("\n\n")).toContain(
        "Work as a pragmatic, effective senior software engineer",
      )
      expect(physicalCustom.system[0]?.text).toBe(fallback)
      expect(familyOpenAI.system[0]?.text).toBe(fallback)
    }),
  )
})
