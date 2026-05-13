import { afterEach, describe, expect } from "bun:test"
import path from "path"
import fs from "fs/promises"
import { pathToFileURL } from "url"
import { Effect, Layer, Result, Schema } from "effect"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { ToolRegistry } from "@/tool/registry"
import { Tool } from "@/tool/tool"
import { disposeAllInstances, TestInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import { TestConfig } from "../fixture/config"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { Plugin } from "@/plugin"
import { Question } from "@/question"
import { Todo } from "@/session/todo"
import { Skill } from "@/skill"
import { Agent } from "@/agent/agent"
import { Session } from "@/session/session"
import { Provider } from "@/provider/provider"
import { ProviderID, ModelID } from "@/provider/schema"
import { Flag } from "@opencode-ai/core/flag/flag"
import { Git } from "@/git"
import { LSP } from "@/lsp/lsp"
import { Instruction } from "@/session/instruction"
import { Bus } from "@/bus"
import { FetchHttpClient } from "effect/unstable/http"
import { Format } from "@/format"
import { Ripgrep } from "@/file/ripgrep"
import * as Truncate from "@/tool/truncate"
import { InstanceState } from "@/effect/instance-state"
import { Reference } from "@/reference/reference"
import { ToolJsonSchema } from "@/tool/json-schema"
import { MessageID, SessionID } from "@/session/schema"
import { RuntimeFlags } from "@/effect/runtime-flags"

const node = CrossSpawnSpawner.defaultLayer
const originalExperimentalScout = Flag.OPENCODE_EXPERIMENTAL_SCOUT

function buildRegistryLayer(configOverrides?: Partial<import("@/config/config").Config.Interface>, flags: Partial<RuntimeFlags.Info> = {}) {
  return ToolRegistry.layer.pipe(
    Layer.provide(
      TestConfig.layer({
        ...configOverrides,
        directories: () => InstanceState.directory.pipe(Effect.map((dir) => [path.join(dir, ".opencode")])),
      }),
    ),
    Layer.provide(RuntimeFlags.layer(flags)),
    Layer.provide(Plugin.defaultLayer),
    Layer.provide(Question.defaultLayer),
    Layer.provide(Todo.defaultLayer),
    Layer.provide(Skill.defaultLayer),
    Layer.provide(Agent.defaultLayer),
    Layer.provide(Session.defaultLayer),
    Layer.provide(Provider.defaultLayer),
    Layer.provide(Git.defaultLayer),
    Layer.provide(Reference.defaultLayer),
    Layer.provide(LSP.defaultLayer),
    Layer.provide(Instruction.defaultLayer),
    Layer.provide(AppFileSystem.defaultLayer),
    Layer.provide(Bus.layer),
    Layer.provide(FetchHttpClient.layer),
    Layer.provide(Format.defaultLayer),
    Layer.provide(node),
    Layer.provide(Ripgrep.defaultLayer),
    Layer.provide(Truncate.defaultLayer),
  )
}

const registryLayer = buildRegistryLayer()
const registryLayerWithToolOverrides = buildRegistryLayer({
  get: () =>
    Effect.succeed({
      tools: {
        read: { description: "Read file" },
        bash: { description: "" },
        task: { description: "custom task description" },
      },
    }),
})

const it = testEffect(Layer.mergeAll(registryLayer, node))
const itWithOverrides = testEffect(Layer.mergeAll(registryLayerWithToolOverrides, node))
const scout = testEffect(Layer.mergeAll(buildRegistryLayer({}, { experimentalScout: true }), node))

afterEach(async () => {
  await disposeAllInstances()
})

describe("tool.registry", () => {
  it.instance("hides repo research tools unless experimental", () =>
    Effect.gen(function* () {
      const registry = yield* ToolRegistry.Service
      const ids = yield* registry.ids()

      expect(ids).not.toContain("repo_clone")
      expect(ids).not.toContain("repo_overview")
    }),
  )

  scout.instance("shows repo research tools when experimental scout is enabled", () =>
    Effect.gen(function* () {
      const registry = yield* ToolRegistry.Service
      const ids = yield* registry.ids()

      expect(ids).toContain("repo_clone")
      expect(ids).toContain("repo_overview")
    }),
  )

  it.instance("loads tools from .opencode/tool (singular)", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      const opencode = path.join(test.directory, ".opencode")
      const tool = path.join(opencode, "tool")
      yield* Effect.promise(() => fs.mkdir(tool, { recursive: true }))
      yield* Effect.promise(() =>
        Bun.write(
          path.join(tool, "hello.ts"),
          [
            "export default {",
            "  description: 'hello tool',",
            "  args: {},",
            "  execute: async () => {",
            "    return 'hello world'",
            "  },",
            "}",
            "",
          ].join("\n"),
        ),
      )
      const registry = yield* ToolRegistry.Service
      const ids = yield* registry.ids()
      expect(ids).toContain("hello")
    }),
  )

  it.instance("loads tools from .opencode/tools (plural)", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      const opencode = path.join(test.directory, ".opencode")
      const tools = path.join(opencode, "tools")
      yield* Effect.promise(() => fs.mkdir(tools, { recursive: true }))
      yield* Effect.promise(() =>
        Bun.write(
          path.join(tools, "hello.ts"),
          [
            "export default {",
            "  description: 'hello tool',",
            "  args: {},",
            "  execute: async () => {",
            "    return 'hello world'",
            "  },",
            "}",
            "",
          ].join("\n"),
        ),
      )
      const registry = yield* ToolRegistry.Service
      const ids = yield* registry.ids()
      expect(ids).toContain("hello")
    }),
  )

  it.instance("loads Zod-schema custom tools with JSON Schema and validation", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      const customTools = path.join(test.directory, ".opencode", "tools")
      const pluginTool = pathToFileURL(path.resolve(import.meta.dir, "../../../plugin/src/tool.ts")).href
      yield* Effect.promise(() => fs.mkdir(customTools, { recursive: true }))
      yield* Effect.promise(() =>
        Bun.write(
          path.join(customTools, "sql.ts"),
          [
            `import { tool } from ${JSON.stringify(pluginTool)}`,
            "export default tool({",
            "  description: 'query database',",
            "  args: { query: tool.schema.string().describe('SQL query to execute') },",
            "  execute: async ({ query }) => query,",
            "})",
            "",
          ].join("\n"),
        ),
      )

      const registry = yield* ToolRegistry.Service
      const loaded = (yield* registry.all()).find((tool) => tool.id === "sql")
      if (!loaded) throw new Error("custom sql tool was not loaded")
      expect(loaded?.jsonSchema).toMatchObject({
        type: "object",
        properties: {
          query: { type: "string", description: "SQL query to execute" },
        },
        required: ["query"],
      })
      expect(Result.isSuccess(Schema.decodeUnknownResult(loaded.parameters)({ query: "select 1" }))).toBe(true)
      expect(Result.isSuccess(Schema.decodeUnknownResult(loaded.parameters)({}))).toBe(false)

      const agents = yield* Agent.Service
      const promptTools = yield* registry.tools({
        providerID: ProviderID.opencode,
        modelID: ModelID.make("test"),
        agent: yield* agents.defaultInfo(),
      })
      const promptTool = promptTools.find((tool) => tool.id === "sql")
      if (!promptTool) throw new Error("custom sql tool was not returned for prompts")
      expect(ToolJsonSchema.fromTool(promptTool)).toMatchObject({
        properties: {
          query: { type: "string", description: "SQL query to execute" },
        },
        required: ["query"],
      })
    }),
  )

  it.instance("preserves attachments from structured custom tool results", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      const customTools = path.join(test.directory, ".opencode", "tools")
      const pluginTool = pathToFileURL(path.resolve(import.meta.dir, "../../../plugin/src/tool.ts")).href
      yield* Effect.promise(() => fs.mkdir(customTools, { recursive: true }))
      yield* Effect.promise(() =>
        Bun.write(
          path.join(customTools, "image.ts"),
          [
            `import { tool } from ${JSON.stringify(pluginTool)}`,
            "export default tool({",
            "  description: 'image tool',",
            "  args: {},",
            "  execute: async () => ({",
            "    output: 'here is an image',",
            "    attachments: [{ type: 'file', mime: 'image/png', filename: 'picture.png', url: 'data:image/png;base64,AAAA' }],",
            "  }),",
            "})",
            "",
          ].join("\n"),
        ),
      )

      const registry = yield* ToolRegistry.Service
      const loaded = (yield* registry.all()).find((tool) => tool.id === "image")
      if (!loaded) throw new Error("custom image tool was not loaded")
      const agents = yield* Agent.Service
      const result = yield* loaded.execute({}, {
        sessionID: SessionID.make("ses_test"),
        messageID: MessageID.make("msg_test"),
        agent: (yield* agents.defaultInfo()).name,
        abort: new AbortController().signal,
        messages: [],
        metadata: () => Effect.void,
        ask: () => Effect.void,
      } satisfies Tool.Context)

      expect(result.output).toBe("here is an image")
      expect(result.attachments).toEqual([
        { type: "file", mime: "image/png", filename: "picture.png", url: "data:image/png;base64,AAAA" },
      ])
    }),
  )

  it.instance("loads legacy JSON-schema-shaped custom tools with wire schema", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      const tools = path.join(test.directory, ".opencode", "tools")
      yield* Effect.promise(() => fs.mkdir(tools, { recursive: true }))
      yield* Effect.promise(() =>
        Bun.write(
          path.join(tools, "legacy.ts"),
          [
            "export default {",
            "  description: 'legacy schema tool',",
            "  args: { text: { type: 'string', description: 'Text to render' } },",
            "  execute: async ({ text }) => text,",
            "}",
            "",
          ].join("\n"),
        ),
      )

      const registry = yield* ToolRegistry.Service
      const loaded = (yield* registry.all()).find((tool) => tool.id === "legacy")
      if (!loaded) throw new Error("legacy custom tool was not loaded")
      expect(ToolJsonSchema.fromTool(loaded)).toMatchObject({
        type: "object",
        properties: {
          text: { type: "string", description: "Text to render" },
        },
        required: ["text"],
      })
    }),
  )

  it.instance("loads tools with external dependencies without crashing", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      const opencode = path.join(test.directory, ".opencode")
      const tools = path.join(opencode, "tools")
      yield* Effect.promise(() => fs.mkdir(tools, { recursive: true }))
      yield* Effect.promise(() =>
        Bun.write(
          path.join(opencode, "package.json"),
          JSON.stringify({
            name: "custom-tools",
            dependencies: {
              "@opencode-ai/plugin": "^0.0.0",
              cowsay: "^1.6.0",
            },
          }),
        ),
      )
      yield* Effect.promise(() =>
        Bun.write(
          path.join(opencode, "package-lock.json"),
          JSON.stringify({
            name: "custom-tools",
            lockfileVersion: 3,
            packages: {
              "": {
                dependencies: {
                  "@opencode-ai/plugin": "^0.0.0",
                  cowsay: "^1.6.0",
                },
              },
            },
          }),
        ),
      )

      const cowsay = path.join(opencode, "node_modules", "cowsay")
      yield* Effect.promise(() => fs.mkdir(cowsay, { recursive: true }))
      yield* Effect.promise(() =>
        Bun.write(
          path.join(cowsay, "package.json"),
          JSON.stringify({
            name: "cowsay",
            type: "module",
            exports: "./index.js",
          }),
        ),
      )
      yield* Effect.promise(() =>
        Bun.write(
          path.join(cowsay, "index.js"),
          ["export function say({ text }) {", "  return `moo ${text}`", "}", ""].join("\n"),
        ),
      )
      yield* Effect.promise(() =>
        Bun.write(
          path.join(tools, "cowsay.ts"),
          [
            "import { say } from 'cowsay'",
            "export default {",
            "  description: 'tool that imports cowsay at top level',",
            "  args: { text: { type: 'string' } },",
            "  execute: async ({ text }: { text: string }) => {",
            "    return say({ text })",
            "  },",
            "}",
            "",
          ].join("\n"),
        ),
      )
      const registry = yield* ToolRegistry.Service
      const ids = yield* registry.ids()
      expect(ids).toContain("cowsay")
    }),
  )

  itWithOverrides.instance("object tool override replaces description", () =>
    Effect.gen(function* () {
      const registry = yield* ToolRegistry.Service
      const tools = yield* registry.tools({
        modelID: ModelID.make("test/model"),
        providerID: ProviderID.make("test"),
        agent: { name: "test", mode: "subagent", options: {}, permission: [{ permission: "*", pattern: "*", action: "allow" }] },
      })
      const readTool = tools.find((t) => t.id === "read")
      expect(readTool).toBeDefined()
      expect(readTool!.description).toBe("Read file")
    }),
  )

  itWithOverrides.instance("empty string description override removes description", () =>
    Effect.gen(function* () {
      const registry = yield* ToolRegistry.Service
      const tools = yield* registry.tools({
        modelID: ModelID.make("test/model"),
        providerID: ProviderID.make("test"),
        agent: { name: "test", mode: "subagent", options: {}, permission: [{ permission: "*", pattern: "*", action: "allow" }] },
      })
      const bashTool = tools.find((t) => t.id === "bash")
      expect(bashTool).toBeDefined()
      expect(bashTool!.description).toBe("")
    }),
  )

  it.instance("tool not in config uses original description", () =>
    Effect.gen(function* () {
      const registry = yield* ToolRegistry.Service
      const tools = yield* registry.tools({
        modelID: ModelID.make("test/model"),
        providerID: ProviderID.make("test"),
        agent: { name: "test", mode: "subagent", options: {}, permission: [{ permission: "*", pattern: "*", action: "allow" }] },
      })
      const invalidTool = tools.find((t) => t.id === "invalid")
      expect(invalidTool).toBeDefined()
      expect(invalidTool!.description.length).toBeGreaterThanOrEqual(10)
    }),
  )

  itWithOverrides.instance("override suppresses describeTask/describeSkill append", () =>
    Effect.gen(function* () {
      const registry = yield* ToolRegistry.Service
      const tools = yield* registry.tools({
        modelID: ModelID.make("test/model"),
        providerID: ProviderID.make("test"),
        agent: { name: "test", mode: "subagent", options: {}, permission: [{ permission: "*", pattern: "*", action: "allow" }] },
      })
      const taskTool = tools.find((t) => t.id === "task")
      expect(taskTool).toBeDefined()
      expect(taskTool!.description).toBe("custom task description")
      expect(taskTool!.description).not.toContain("Available agent types")
    }),
  )
})
