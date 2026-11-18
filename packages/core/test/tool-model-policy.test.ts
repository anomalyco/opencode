import { describe, expect, test } from "bun:test"
import { Agent } from "@opencode/core/agent"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { Flag } from "@opencode/core/flag"
import { InstructionBuiltIns } from "@opencode/core/instructions/builtins"
import { InstructionDiscovery } from "@opencode/core/instruction-discovery"
import { Instructions } from "@opencode/core/instructions/index"
import { Location } from "@opencode/core/location"
import { Mcp } from "@opencode/core/mcp/index"
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
import { EditTool } from "@opencode/core/tool/plugin/edit"
import { PatchTool } from "@opencode/core/tool/plugin/patch"
import { WriteTool } from "@opencode/core/tool/plugin/write"
import { WebSearch } from "@opencode/core/websearch"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { FileMutation } from "@opencode/core/file-mutation"
import { FileWrite } from "@opencode/core/file-write"
import { Formatter } from "@opencode/core/formatter"
import { Effect, Layer, Schema } from "effect"
import { testEffect } from "./lib/effect"
import { readInitial } from "./lib/instructions"
import { codeModeListings, registerToolPlugin } from "./lib/tool"
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
  test("with fullCodeMode enabled, gives GPT-5+ models patch and places file tools and shell in Code Mode", () => {
    for (const model of [
      makeModel("openai", "gpt-5"),
      makeModel("openai", "gpt-5.4-codex"),
      makeModel("azure", "deployment", { modelID: Model.ID.make("gpt-6") }),
    ]) {
      const result = modelTools({ model, websearch: true, fullCodeMode: true })
      expect([...result.codemode].sort()).toEqual(["patch", "read", "shell"])
      expect([...result.hidden].sort()).toEqual(["edit", "glob", "grep", "webfetch", "write"])
    }
  })

  test("keeps edit and write instead of patch for gpt-4 and gpt-oss models while placing file tools and shell in Code Mode when fullCodeMode is on", () => {
    for (const model of [
      makeModel("openai", "gpt-4o"),
      makeModel("openai", "gpt-4.1"),
      makeModel("openrouter", "openai/gpt-oss-120b"),
      makeModel("azure", "gpt-deployment", { modelID: Model.ID.make("gpt-4o") }),
    ]) {
      const result = modelTools({ model, websearch: true, fullCodeMode: true })
      expect([...result.codemode].sort()).toEqual(["edit", "read", "shell", "write"])
      expect([...result.hidden].sort()).toEqual(["glob", "grep", "patch", "webfetch"])
    }
  })

  test("treats Anthropic, Claude, and all claude-agent models as strong when fullCodeMode is on", () => {
    for (const model of [
      makeModel("anthropic", "claude-sonnet-4-5"),
      makeModel("anthropic", "custom-sonnet"),
      makeModel("claude-agent", "opus"),
      makeModel("claude-agent", "sonnet"),
      makeModel("claude-agent", "fable"),
      makeModel("claude-agent", "haiku", { family: Model.Family.make("claude-haiku") }),
      makeModel("amazon-bedrock", "us.anthropic.claude-opus-4-6-v1"),
      makeModel("openrouter", "anthropic/claude-sonnet-4"),
      makeModel("custom", "sonnet-v4", { family: Model.Family.make("claude-sonnet") }),
      makeModel("gateway", "sonnet", { canonical: Provider.ID.make("anthropic") }),
    ]) {
      const result = modelTools({ model, websearch: true, fullCodeMode: true })
      expect([...result.codemode].sort()).toEqual(["edit", "read", "shell", "write"])
      expect([...result.hidden].sort()).toEqual(["glob", "grep", "patch", "webfetch"])
    }
  })

  test("with fullCodeMode off, keeps file tools, shell, glob, grep, and webfetch direct for every model while still applying patch/edit+write and websearch rules", () => {
    expect(modelTools({ model: makeModel("openai", "gpt-5"), websearch: true, fullCodeMode: false })).toEqual({
      hidden: new Set(["edit", "write"]),
      codemode: new Set(),
    })
    expect(
      modelTools({ model: makeModel("anthropic", "claude-sonnet-4-5"), websearch: true, fullCodeMode: false }),
    ).toEqual({
      hidden: new Set(["patch"]),
      codemode: new Set(),
    })
    expect(modelTools({ model: makeModel("claude-agent", "opus"), websearch: false, fullCodeMode: false })).toEqual({
      hidden: new Set(["patch", "websearch"]),
      codemode: new Set(),
    })
  })

  test("keeps file tools, shell, glob, grep, and webfetch direct for non-strong models even with fullCodeMode on", () => {
    for (const model of [makeModel("deepseek", "deepseek-reasoner"), makeModel("opencode", "gemini-4-carbon")]) {
      const result = modelTools({ model, websearch: true, fullCodeMode: true })
      expect([...result.codemode]).toEqual([])
      expect([...result.hidden]).toEqual(["patch"])
    }
  })

  test("hides websearch when unavailable and applies no model rules when model is absent", () => {
    expect(modelTools({ model: undefined, websearch: true, fullCodeMode: true })).toEqual({
      hidden: new Set(),
      codemode: new Set(),
    })
    expect(modelTools({ model: undefined, websearch: false, fullCodeMode: true })).toEqual({
      hidden: new Set(["websearch"]),
      codemode: new Set(),
    })
  })
})

const makeContextLayer = (overrides: string | undefined) => {
  const mcp = Layer.mock(Mcp.Service, {
    awaitStartup: () => Effect.void,
    instructions: () => Effect.succeed([{ server: Mcp.ServerName.make("alpha"), instructions: "Alpha docs" }]),
    tools: () =>
      Effect.succeed([{ server: Mcp.ServerName.make("alpha"), name: "search", inputSchema: { type: "object" } }]),
  })
  return Layer.mergeAll(
    PluginTestLayer,
    AppNodeBuilder.build(LayerNode.group([SessionContext.node, FileMutation.node, FileWrite.node, Formatter.node]), [
      Location.node.replace(Location.boundNode({ directory: AbsolutePath.make("/project") })),
      Mcp.node.replace(mcp),
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
    ]),
  ).pipe(Layer.provide(Layer.succeed(Flag.Overrides, overrides)))
}

const defaultIt = testEffect(makeContextLayer(undefined))
const codeModeIt = testEffect(makeContextLayer("full_codemode"))

describe("SessionContext.select model tool policy", () => {
  defaultIt.effect(
    "keeps strong-model file tools, shell, glob, grep, and webfetch direct when full_codemode is off",
    () =>
      Effect.gen(function* () {
        const agents = yield* Agent.Service
        const providers = yield* Provider.Service
        const models = yield* Model.Service
        const registry = yield* Tool.Service
        const sessions = yield* Session.Service
        const context = yield* SessionContext.Service

        yield* registerToolPlugin(EditTool.Plugin)
        yield* registerToolPlugin(WriteTool.Plugin)
        yield* registerToolPlugin(PatchTool.Plugin)
        for (const tool of yield* registry.list()) {
          expect(tool.options?.pinned).toBe(true)
          expect(tool.codemode?.description).toBeDefined()
          expect(tool.codemode?.description).not.toContain("\n")
          expect(tool.codemode!.description!.length).toBeLessThan(500)
        }

        yield* agents.transform((editor) =>
          editor.update(Agent.defaultID, (agent) => {
            agent.mode = "primary"
          }),
        )
        yield* providers.transform((editor) =>
          editor.update(Provider.ID.make("openai"), (provider) => {
            provider.activation = "enabled"
          }),
        )
        yield* models.transform((editor) =>
          editor.update(Provider.ID.make("openai"), Model.ID.make("gpt-5"), (model) => {
            model.package = Provider.aisdk("@ai-sdk/openai")
          }),
        )
        yield* registry.transform((editor) => {
          for (const name of ["read", "glob", "grep", "webfetch", "shell"]) {
            editor.add({
              name,
              description: name,
              input: Schema.Struct({}),
              output: Schema.String,
              options: { codemode: false },
              execute: () => Effect.succeed({ output: name }),
            })
          }
        })

        const session = yield* sessions.create({
          location: Location.Ref.make({ directory: AbsolutePath.make("/project") }),
          model: Model.Ref.make({ providerID: Provider.ID.make("openai"), id: Model.ID.make("gpt-5") }),
        })
        const selected = yield* context.select(session.id)
        expect(selected.tools.definitions.map((tool) => tool.name)).toEqual([
          "glob",
          "grep",
          "patch",
          "read",
          "shell",
          "webfetch",
          "execute",
        ])
      }),
  )

  codeModeIt.effect(
    "places tools per model, propagates Code Mode to MCP instructions, and uses configured ref fallback",
    () =>
      Effect.gen(function* () {
        const agents = yield* Agent.Service
        const providers = yield* Provider.Service
        const models = yield* Model.Service
        const registry = yield* Tool.Service
        const websearch = yield* WebSearch.Service
        const sessions = yield* Session.Service
        const context = yield* SessionContext.Service

        yield* registerToolPlugin(EditTool.Plugin)
        yield* registerToolPlugin(WriteTool.Plugin)
        yield* registerToolPlugin(PatchTool.Plugin)

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
              ...(name === "read" || name === "shell" ? { codemode: { description: `Code Mode ${name}` } } : {}),
              input: Schema.Struct({}),
              output: Schema.String,
              options: { codemode: false, ...(name === "read" || name === "shell" ? { pinned: true } : {}) },
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

        const selectFor = (providerID: string, id: string, permissions?: Session.Info["permissions"]) =>
          Effect.gen(function* () {
            const session = yield* sessions.create({
              location: Location.Ref.make({ directory: AbsolutePath.make("/project") }),
              model: Model.Ref.make({ providerID: Provider.ID.make(providerID), id: Model.ID.make(id) }),
              ...(permissions ? { permissions } : {}),
            })
            return yield* context.select(session.id)
          })

        const gpt = yield* selectFor("openai", "gpt-5")
        expect(gpt.tools.definitions.map((tool) => tool.name)).toEqual(["websearch", "execute"])
        const gptListings = codeModeListings(gpt.tools.codeModeCatalog!)
        expect(gptListings.map((entry) => entry.path)).toEqual([
          "alpha.search",
          "opencode.session_move",
          "patch",
          "read",
          "shell",
        ])
        expect(gptListings.find((entry) => entry.path === "patch")?.line).toContain("*** Begin Patch")
        expect(gptListings.find((entry) => entry.path === "patch")?.line).toContain("*** End Patch")
        expect(gptListings.find((entry) => entry.path === "read")?.line).toContain("Code Mode read")
        expect((yield* readInitial(gpt.instructions)).text).toContain(
          'Use tools from this server through `execute` under `tools["alpha"]`.',
        )

        // When execute is denied, MCP instructions reflect direct tool access instead of execute.
        const gptDirect = yield* selectFor("openai", "gpt-5", [{ action: "execute", resource: "*", effect: "deny" }])
        const directInstructions = (yield* readInitial(gptDirect.instructions)).text
        expect(directInstructions).toContain("Alpha docs")
        expect(directInstructions).not.toContain("through `execute`")

        const claude = yield* selectFor("anthropic", "claude-sonnet-4-5")
        expect(claude.tools.definitions.map((tool) => tool.name)).toEqual(["websearch", "execute"])
        expect(codeModeListings(claude.tools.codeModeCatalog!).map((entry) => entry.path)).toEqual([
          "alpha.search",
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
          "alpha.search",
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
        expect((yield* selectFor("openai", "gpt-5")).tools.definitions.map((tool) => tool.name)).toEqual(["execute"])

        // An unavailable model falls back to the configured ref in select, and surfaces ModelUnavailableError in load.
        const unavailable = yield* selectFor("openai", "gpt-5-missing")
        expect(unavailable.tools.definitions.map((tool) => tool.name)).toEqual(["execute"])
        expect(codeModeListings(unavailable.tools.codeModeCatalog!).map((entry) => entry.path)).toContain("patch")
        expect(yield* context.load(unavailable).pipe(Effect.flip)).toBeInstanceOf(
          SessionRunnerModel.ModelUnavailableError,
        )
      }),
  )
})
