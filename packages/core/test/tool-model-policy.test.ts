import { describe, expect, test } from "bun:test"
import { Agent } from "@opencode/core/agent"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { FileMutation } from "@opencode/core/file-mutation"
import { FileWrite } from "@opencode/core/file-write"
import { Flag } from "@opencode/core/flag"
import { Formatter } from "@opencode/core/formatter"
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
import { Effect, Layer, Schema } from "effect"
import { testEffect } from "./lib/effect"
import { readInitial } from "./lib/instructions"
import { codeModeListings, registerToolPlugin } from "./lib/tool"
import { PluginTestLayer } from "./plugin/fixture"

const makeModel = (
  providerID: string,
  id: string,
  overrides: Partial<Pick<Model.Info, "modelID" | "family" | "canonical">> = {},
): Model.Info => ({
  ...Model.Info.default(Provider.ID.make(providerID), Model.ID.make(id)),
  ...overrides,
  package: Provider.aisdk("@ai-sdk/openai"),
})

const policy = (model: Model.Info | undefined, websearch = true, fullCodeMode = true) => {
  const result = modelTools({ model, websearch, fullCodeMode })
  return { direct: [...result.direct].sort(), hidden: [...result.hidden].sort() }
}

describe("modelTools", () => {
  test("reports whether the model takes raw-text tools", () => {
    const model = makeModel("openai", "gpt-6")
    expect(modelTools({ model, websearch: true, fullCodeMode: true }).rawText).toBe(false)
    expect(
      modelTools({
        model: { ...model, capabilities: { ...model.capabilities, freeform: ["text"] } },
        websearch: true,
        fullCodeMode: true,
      }).rawText,
    ).toBe(true)
  })

  test("gives GPT-5+ patch and leaves file tools, shell, and websearch in Code Mode when fullCodeMode is on", () => {
    for (const model of [makeModel("openai", "gpt-5"), makeModel("azure", "dep", { modelID: Model.ID.make("gpt-6") })])
      expect(policy(model)).toEqual({
        direct: [],
        hidden: ["edit", "glob", "grep", "webfetch", "write"],
      })
  })

  test("keeps edit and write instead of patch for gpt-4 and gpt-oss models", () => {
    for (const model of [
      makeModel("openai", "gpt-4.1"),
      makeModel("openrouter", "openai/gpt-oss-120b"),
      makeModel("azure", "gpt-dep", { modelID: Model.ID.make("gpt-4o") }),
    ])
      expect(policy(model)).toEqual({
        direct: [],
        hidden: ["glob", "grep", "patch", "webfetch"],
      })
  })

  test("leaves built-ins in Code Mode for all models when fullCodeMode is on", () => {
    for (const model of [
      makeModel("anthropic", "custom-sonnet"),
      makeModel("claude-agent", "opus"),
      makeModel("deepseek", "deepseek-reasoner"),
      makeModel("zhipu", "glm-5.3"),
      makeModel("google", "gemini-4-neon"),
    ])
      expect(policy(model)).toEqual({
        direct: [],
        hidden: ["glob", "grep", "patch", "webfetch"],
      })
  })

  test("hides glob, grep, and webfetch for every model when fullCodeMode is on", () => {
    for (const model of [
      makeModel("openai", "gpt-5"),
      makeModel("anthropic", "claude-sonnet-4-5"),
      makeModel("deepseek", "deepseek-reasoner"),
      makeModel("zhipu", "glm-5.3"),
      makeModel("google", "gemini-4-neon"),
      undefined,
    ]) {
      const { hidden } = policy(model)
      for (const name of ["glob", "grep", "webfetch"]) expect(hidden).toContain(name)
    }
  })

  test("applies patch and websearch rules when fullCodeMode is off", () => {
    expect(policy(makeModel("openai", "gpt-5"), true, false)).toEqual({ direct: [], hidden: ["edit", "write"] })
    expect(policy(makeModel("claude-agent", "opus"), false, false)).toEqual({
      direct: [],
      hidden: ["patch", "websearch"],
    })
  })

  test("handles absent models when fullCodeMode is on, hiding websearch when unavailable", () => {
    expect(policy(undefined, true, true)).toEqual({
      direct: [],
      hidden: ["glob", "grep", "webfetch"],
    })
    expect(policy(undefined, false, true)).toEqual({
      direct: [],
      hidden: ["glob", "grep", "webfetch", "websearch"],
    })
  })
})

const emptyInstructions = () => Effect.succeed(Instructions.empty)
const makeContextLayer = (overrides: string | undefined) =>
  Layer.mergeAll(
    PluginTestLayer,
    AppNodeBuilder.build(LayerNode.group([SessionContext.node, FileMutation.node, FileWrite.node, Formatter.node]), [
      Location.node.replace(Location.boundNode({ directory: AbsolutePath.make("/project") })),
      Mcp.node.replace(
        Layer.mock(Mcp.Service, {
          awaitStartup: () => Effect.void,
          instructions: () => Effect.succeed([{ server: Mcp.ServerName.make("alpha"), instructions: "Alpha docs" }]),
          tools: () =>
            Effect.succeed([{ server: Mcp.ServerName.make("alpha"), name: "search", inputSchema: { type: "object" } }]),
        }),
      ),
      InstructionBuiltIns.node.replace(Layer.mock(InstructionBuiltIns.Service, { load: emptyInstructions })),
      InstructionDiscovery.node.replace(
        Layer.mock(InstructionDiscovery.Service, {
          project: true,
          global: true,
          claude: true,
          load: emptyInstructions,
        }),
      ),
      SkillInstructions.node.replace(Layer.mock(SkillInstructions.Service, { load: emptyInstructions })),
      ReferenceInstructions.node.replace(Layer.mock(ReferenceInstructions.Service, { load: emptyInstructions })),
    ]),
  ).pipe(Layer.provide(Layer.succeed(Flag.Overrides, overrides)))

const setupContext = Effect.gen(function* () {
  const agents = yield* Agent.Service
  const providers = yield* Provider.Service
  const models = yield* Model.Service
  const registry = yield* Tool.Service
  const websearch = yield* WebSearch.Service
  const sessions = yield* Session.Service
  const context = yield* SessionContext.Service
  const flags = yield* Flag.Service
  const fullCodeMode = yield* flags.enabled("full_codemode")

  yield* Effect.all([
    registerToolPlugin(EditTool.Plugin),
    registerToolPlugin(WriteTool.Plugin),
    registerToolPlugin(PatchTool.Plugin),
  ])
  yield* agents.transform((editor) =>
    editor.update(Agent.defaultID, (agent) => {
      agent.mode = "primary"
    }),
  )
  yield* providers.transform((editor) => {
    for (const id of ["openai", "anthropic", "deepseek"])
      editor.update(Provider.ID.make(id), (provider) => {
        provider.activation = "enabled"
      })
  })
  yield* models.transform((editor) => {
    for (const [provider, id] of [
      ["openai", "gpt-5"],
      ["anthropic", "claude-sonnet-4-5"],
      ["deepseek", "deepseek-reasoner"],
    ] as const)
      editor.update(Provider.ID.make(provider), Model.ID.make(id), (model) => {
        model.package = Provider.aisdk("@ai-sdk/openai")
      })
  })
  yield* websearch.transform((editor) =>
    editor.add({ id: WebSearch.ID.make("exa"), name: "Exa", execute: () => Effect.succeed([]) }),
  )
  yield* registry.transform((editor) => {
    for (const name of ["read", "glob", "grep", "webfetch", "websearch", "shell"]) {
      const variant = name === "read" || name === "shell"
      editor.add({
        name,
        description: `Direct ${name}`,
        input: Schema.Struct({}),
        output: Schema.String,
        options: variant
          ? fullCodeMode
            ? { codemode: { pinned: true, description: `Code Mode ${name}` } }
            : { codemode: false }
          : name === "websearch"
            ? { codemode: fullCodeMode }
            : { codemode: false },
        execute: () => Effect.succeed({ output: name }),
      })
    }
    editor.add({
      name: "session_move",
      description: "Move session",
      input: Schema.Struct({}),
      output: Schema.String,
      options: { namespace: "opencode", codemode: { pinned: true } },
      execute: () => Effect.succeed({ output: "moved" }),
    })
  })

  const select = (providerID: string, id: string, permissions?: Session.Info["permissions"]) =>
    sessions
      .create({
        location: Location.Ref.make({ directory: AbsolutePath.make("/project") }),
        model: Model.Ref.make({ providerID: Provider.ID.make(providerID), id: Model.ID.make(id) }),
        ...(permissions ? { permissions } : {}),
      })
      .pipe(Effect.flatMap((session) => context.select(session.id)))

  return { registry, websearch, context, select }
})

const names = (selected: SessionContext.Selection) => selected.tools.definitions.map((tool) => tool.name)
const paths = (selected: SessionContext.Selection) =>
  codeModeListings(selected.tools.codeModeCatalog!).map((entry) => entry.path)
const defaultIt = testEffect(makeContextLayer(undefined))
const codeModeIt = testEffect(makeContextLayer("full_codemode"))

describe("SessionContext.select model tool policy", () => {
  defaultIt.effect("keeps built-in tools direct when full_codemode is off", () =>
    Effect.gen(function* () {
      const { select } = yield* setupContext
      expect(names(yield* select("openai", "gpt-5")).join(",")).toBe(
        "glob,grep,patch,read,shell,webfetch,websearch,execute",
      )
    }),
  )

  codeModeIt.effect(
    "places tools per model, propagates Code Mode to MCP instructions, and uses configured ref fallback",
    () =>
      Effect.gen(function* () {
        const { registry, websearch, context, select } = yield* setupContext

        const catalog = (yield* registry.snapshot()).codeModeCatalog!
        for (const name of ["edit", "write", "patch"]) {
          const entry = catalog.tools.find((item) => item.type === "tool" && item.name === name)
          expect(entry).toMatchObject({ type: "tool", pinned: true })
          if (entry?.type !== "tool") continue
          expect(entry.description).not.toContain("\n")
          expect(entry.description.length).toBeLessThan(500)
        }

        const gpt = yield* select("openai", "gpt-5")
        expect(names(gpt)).toEqual(["execute"])
        const gptListings = codeModeListings(gpt.tools.codeModeCatalog!)
        expect(gptListings.map((entry) => entry.path)).toEqual([
          "alpha.search",
          "opencode.session_move",
          "patch",
          "read",
          "shell",
          "websearch",
        ])
        expect(gptListings.find((entry) => entry.path === "patch")?.line).toContain("*** Begin Patch")
        expect(gptListings.find((entry) => entry.path === "read")?.line).toContain("Code Mode read")
        expect((yield* readInitial(gpt.instructions)).text).toContain(
          'Use tools from this server through `execute` under `tools["alpha"]`.',
        )

        const gptDirect = yield* select("openai", "gpt-5", [{ action: "execute", resource: "*", effect: "deny" }])
        const directInstructions = (yield* readInitial(gptDirect.instructions)).text
        expect(directInstructions).toContain("Alpha docs")
        expect(directInstructions).not.toContain("through `execute`")
        // Without `execute`, as for the explore agent, the search and fetch tools stay direct.
        for (const name of ["glob", "grep", "webfetch"]) expect(names(gptDirect)).toContain(name)
        const deepseekDirect = yield* select("deepseek", "deepseek-reasoner", [
          { action: "execute", resource: "*", effect: "deny" },
        ])
        for (const name of ["glob", "grep", "webfetch"]) expect(names(deepseekDirect)).toContain(name)

        const claude = yield* select("anthropic", "claude-sonnet-4-5")
        expect(names(claude)).toEqual(["execute"])
        expect(paths(claude).join(",")).toBe("alpha.search,edit,opencode.session_move,read,shell,websearch,write")

        const deepseek = yield* select("deepseek", "deepseek-reasoner")
        expect(names(deepseek)).toEqual(["execute"])
        expect(paths(deepseek).join(",")).toBe("alpha.search,edit,opencode.session_move,read,shell,websearch,write")

        yield* websearch.select(false)
        expect(paths(yield* select("openai", "gpt-5"))).not.toContain("websearch")

        const unavailable = yield* select("openai", "gpt-5-missing")
        expect(paths(unavailable)).toContain("patch")
        expect(yield* context.load(unavailable).pipe(Effect.flip)).toBeInstanceOf(
          SessionRunnerModel.ModelUnavailableError,
        )
      }),
  )
})
