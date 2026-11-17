import { describe, expect, test } from "bun:test"
import { Agent } from "@opencode/core/agent"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { InstructionBuiltIns } from "@opencode/core/instructions/builtins"
import { InstructionDiscovery } from "@opencode/core/instruction-discovery"
import { Instructions } from "@opencode/core/instructions/index"
import { Location } from "@opencode/core/location"
import { McpInstructions } from "@opencode/core/mcp/instructions"
import { Model } from "@opencode/core/model"
import { Provider } from "@opencode/core/provider"
import { ReferenceInstructions } from "@opencode/core/reference/instructions"
import { AbsolutePath } from "@opencode/core/schema"
import { Session } from "@opencode/core/session"
import { SessionContext } from "@opencode/core/session/context"
import { SessionRunnerModel } from "@opencode/core/session/runner/model"
import { SkillInstructions } from "@opencode/core/skill/instructions"
import { Tool } from "@opencode/core/tool"
import { modelTools } from "@opencode/core/tool/model-policy"
import { WebSearch } from "@opencode/core/websearch"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Effect, Layer, Schema } from "effect"
import { testEffect } from "./lib/effect"
import { codeModeListings } from "./lib/tool"
import { PluginTestLayer } from "./plugin/fixture"

const makeModel = (
  providerID: string,
  id: string,
  overrides: Partial<Pick<Model.Info, "modelID" | "family" | "canonical" | "package">> = {},
): Model.Info => ({
  ...Model.Info.default(Provider.ID.make(providerID), Model.ID.make(id)),
  ...(overrides.modelID === undefined ? {} : { modelID: overrides.modelID }),
  ...(overrides.family === undefined ? {} : { family: overrides.family }),
  ...(overrides.canonical === undefined ? {} : { canonical: overrides.canonical }),
  package: overrides.package ?? Provider.aisdk("@ai-sdk/openai"),
})

describe("modelTools", () => {
  test("gives GPT-5+ models patch and places file tools and shell in Code Mode with glob, grep, and webfetch hidden", () => {
    for (const model of [
      makeModel("openai", "gpt-5"),
      makeModel("openai", "gpt-5.4-codex"),
      makeModel("azure", "gpt-6"),
    ]) {
      const result = modelTools({ model, websearch: true })
      expect([...result.codemode].sort()).toEqual(["patch", "read", "shell"])
      expect([...result.hidden].sort()).toEqual(["edit", "glob", "grep", "webfetch", "write"])
    }
  })

  test("keeps edit and write instead of patch for gpt-4 and gpt-oss models while still placing file tools and shell in Code Mode", () => {
    for (const model of [
      makeModel("openai", "gpt-4o"),
      makeModel("openai", "gpt-4.1"),
      makeModel("openrouter", "openai/gpt-oss-120b"),
    ]) {
      const result = modelTools({ model, websearch: true })
      expect([...result.codemode].sort()).toEqual(["edit", "read", "shell", "write"])
      expect([...result.hidden].sort()).toEqual(["glob", "grep", "patch", "webfetch"])
    }
  })

  test("gives Claude and Anthropic models edit, write, read, and shell in Code Mode with patch, glob, grep, and webfetch hidden", () => {
    for (const model of [
      makeModel("anthropic", "claude-sonnet-4-5"),
      makeModel("anthropic", "custom-sonnet"),
      makeModel("amazon-bedrock", "us.anthropic.claude-opus-4-6-v1"),
      makeModel("openrouter", "anthropic/claude-sonnet-4"),
      makeModel("custom", "sonnet-v4", { family: Model.Family.make("claude-sonnet") }),
      makeModel("gateway", "sonnet", { canonical: Provider.ID.make("anthropic") }),
    ]) {
      const result = modelTools({ model, websearch: true })
      expect([...result.codemode].sort()).toEqual(["edit", "read", "shell", "write"])
      expect([...result.hidden].sort()).toEqual(["glob", "grep", "patch", "webfetch"])
    }
  })

  test("keeps file tools, shell, glob, grep, and webfetch as direct tools for non-strong models", () => {
    for (const model of [makeModel("deepseek", "deepseek-reasoner"), makeModel("opencode", "gemini-4-carbon")]) {
      const result = modelTools({ model, websearch: true })
      expect([...result.codemode]).toEqual([])
      expect([...result.hidden]).toEqual(["patch"])
    }
  })

  test("hides websearch when disabled or no provider is available, and applies no model rules when model is absent", () => {
    expect([...modelTools({ model: makeModel("openai", "gpt-5"), websearch: false }).hidden].sort()).toEqual([
      "edit",
      "glob",
      "grep",
      "webfetch",
      "websearch",
      "write",
    ])
    expect([...modelTools({ model: makeModel("deepseek", "deepseek-chat"), websearch: false }).hidden].sort()).toEqual([
      "patch",
      "websearch",
    ])
    expect(modelTools({ model: undefined, websearch: true })).toEqual({
      hidden: new Set(),
      codemode: new Set(),
    })
    expect(modelTools({ model: undefined, websearch: false })).toEqual({
      hidden: new Set(["websearch"]),
      codemode: new Set(),
    })
  })
})

const contextLayer = Layer.mergeAll(
  PluginTestLayer,
  AppNodeBuilder.build(LayerNode.group([SessionContext.node]), [
    Location.node.replace(Location.boundNode({ directory: AbsolutePath.make("/project") })),
    InstructionBuiltIns.node.replace(
      Layer.mock(InstructionBuiltIns.Service, { load: () => Effect.succeed(Instructions.empty) }),
    ),
    InstructionDiscovery.node.replace(
      Layer.mock(InstructionDiscovery.Service, {
        project: true,
        global: true,
        claude: true,
        claudeGlobal: true,
        load: () => Effect.succeed(Instructions.empty),
      }),
    ),
    SkillInstructions.node.replace(
      Layer.mock(SkillInstructions.Service, { load: () => Effect.succeed(Instructions.empty) }),
    ),
    ReferenceInstructions.node.replace(
      Layer.mock(ReferenceInstructions.Service, { load: () => Effect.succeed(Instructions.empty) }),
    ),
    McpInstructions.node.replace(
      Layer.mock(McpInstructions.Service, { load: () => Effect.succeed(Instructions.empty) }),
    ),
  ]),
)

const it = testEffect(contextLayer)

describe("SessionContext.select model tool policy", () => {
  it.effect("places tools per selected model and websearch availability, falling back cleanly when unavailable", () =>
    Effect.gen(function* () {
      const agents = yield* Agent.Service
      const providers = yield* Provider.Service
      const models = yield* Model.Service
      const registry = yield* Tool.Service
      const websearch = yield* WebSearch.Service
      const sessions = yield* Session.Service
      const context = yield* SessionContext.Service

      yield* agents.transform((editor) =>
        editor.update(Agent.defaultID, (agent) => {
          agent.mode = "primary"
        }),
      )
      yield* providers.transform((editor) => {
        for (const id of ["openai", "anthropic", "deepseek"]) {
          editor.update(Provider.ID.make(id), (provider) => {
            provider.activation = "enabled"
          })
        }
      })
      yield* models.transform((editor) => {
        editor.update(Provider.ID.make("openai"), Model.ID.make("gpt-5"), (model) => {
          model.package = Provider.aisdk("@ai-sdk/openai")
        })
        editor.update(Provider.ID.make("anthropic"), Model.ID.make("claude-sonnet-4-5"), (model) => {
          model.package = Provider.aisdk("@ai-sdk/anthropic")
        })
        editor.update(Provider.ID.make("deepseek"), Model.ID.make("deepseek-reasoner"), (model) => {
          model.package = Provider.aisdk("@ai-sdk/openai-compatible")
        })
      })
      yield* websearch.transform((editor) =>
        editor.add({
          id: WebSearch.ID.make("exa"),
          name: "Exa",
          execute: () => Effect.succeed([]),
        }),
      )
      yield* registry.transform((editor) => {
        for (const name of ["read", "glob", "grep", "webfetch", "websearch", "shell"]) {
          editor.add({
            name,
            description: `Direct ${name}`,
            ...(name === "read" || name === "shell"
              ? { codemode: { description: `Code Mode ${name}`, ...(name === "shell" ? { pinned: true } : {}) } }
              : {}),
            input: Schema.Struct({}),
            output: Schema.String,
            options: { codemode: false },
            execute: () => Effect.succeed({ output: name }),
          })
        }
        for (const name of ["edit", "write", "patch"]) {
          editor.add({
            name,
            description: name,
            input: Schema.Struct({}),
            output: Schema.String,
            options: { codemode: false, permission: "edit" },
            execute: () => Effect.succeed({ output: name }),
          })
        }
        editor.add({
          name: "session_move",
          description: "Move session",
          input: Schema.Struct({}),
          output: Schema.String,
          options: { namespace: "opencode", codemode: true, pinned: true },
          execute: () => Effect.succeed({ output: "moved" }),
        })
      })

      const selectFor = (providerID: string, id: string) =>
        Effect.gen(function* () {
          const session = yield* sessions.create({
            location: Location.Ref.make({ directory: AbsolutePath.make("/project") }),
            model: Model.Ref.make({ providerID: Provider.ID.make(providerID), id: Model.ID.make(id) }),
          })
          return yield* context.select(session.id)
        })

      const gpt = yield* selectFor("openai", "gpt-5")
      expect(gpt.tools.definitions.map((tool) => tool.name)).toEqual(["websearch", "execute"])
      expect(codeModeListings(gpt.tools.codeModeCatalog!).map((entry) => entry.path)).toEqual([
        "opencode.session_move",
        "patch",
        "read",
        "shell",
      ])
      expect(codeModeListings(gpt.tools.codeModeCatalog!).find((entry) => entry.path === "read")?.line).toContain(
        "Code Mode read",
      )

      const claude = yield* selectFor("anthropic", "claude-sonnet-4-5")
      expect(claude.tools.definitions.map((tool) => tool.name)).toEqual(["websearch", "execute"])
      expect(codeModeListings(claude.tools.codeModeCatalog!).map((entry) => entry.path)).toEqual([
        "edit",
        "opencode.session_move",
        "read",
        "shell",
        "write",
      ])

      const deepseek = yield* selectFor("deepseek", "deepseek-reasoner")
      expect(deepseek.tools.definitions.map((tool) => tool.name)).toEqual([
        "edit",
        "glob",
        "grep",
        "read",
        "shell",
        "webfetch",
        "websearch",
        "write",
        "execute",
      ])
      expect(deepseek.tools.definitions.find((tool) => tool.name === "read")?.description).toBe("Direct read")
      expect(codeModeListings(deepseek.tools.codeModeCatalog!).map((entry) => entry.path)).toEqual([
        "opencode.session_move",
      ])

      // Removing all providers or turning off websearch hides the websearch tool.
      yield* websearch.transform((editor) => editor.remove(WebSearch.ID.make("exa")))
      expect((yield* selectFor("openai", "gpt-5")).tools.definitions.map((tool) => tool.name)).toEqual(["execute"])
      yield* websearch.transform((editor) =>
        editor.add({
          id: WebSearch.ID.make("exa"),
          name: "Exa",
          execute: () => Effect.succeed([]),
        }),
      )
      yield* websearch.select(false)
      const withoutWebSearch = yield* selectFor("openai", "gpt-5")
      expect(withoutWebSearch.tools.definitions.map((tool) => tool.name)).toEqual(["execute"])

      // An unavailable model applies no model rules in select and surfaces ModelUnavailableError in load.
      const unavailable = yield* selectFor("openai", "missing-model")
      expect(unavailable.tools.definitions.map((tool) => tool.name)).toContain("patch")
      expect(unavailable.tools.definitions.map((tool) => tool.name)).toContain("edit")
      expect(yield* context.load(unavailable).pipe(Effect.flip)).toBeInstanceOf(
        SessionRunnerModel.ModelUnavailableError,
      )
    }),
  )
})
