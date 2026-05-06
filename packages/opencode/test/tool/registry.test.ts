import { afterEach, describe, expect } from "bun:test"
import path from "path"
import fs from "fs/promises"
import { Effect, Layer } from "effect"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { ToolRegistry } from "@/tool/registry"
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
import { LSP } from "@/lsp/lsp"
import { Instruction } from "@/session/instruction"
import { Bus } from "@/bus"
import { FetchHttpClient } from "effect/unstable/http"
import { Format } from "@/format"
import { Ripgrep } from "@/file/ripgrep"
import * as Truncate from "@/tool/truncate"
import { InstanceState } from "@/effect/instance-state"

const node = CrossSpawnSpawner.defaultLayer
const configLayer = TestConfig.layer({
  directories: () => InstanceState.directory.pipe(Effect.map((dir) => [path.join(dir, ".opencode")])),
})

const registryLayer = ToolRegistry.layer.pipe(
  Layer.provide(configLayer),
  Layer.provide(Plugin.defaultLayer),
  Layer.provide(Question.defaultLayer),
  Layer.provide(Todo.defaultLayer),
  Layer.provide(Skill.defaultLayer),
  Layer.provide(Agent.defaultLayer),
  Layer.provide(Session.defaultLayer),
  Layer.provide(Provider.defaultLayer),
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

const it = testEffect(Layer.mergeAll(registryLayer, node))

afterEach(async () => {
  await disposeAllInstances()
})

describe("tool.registry", () => {
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
})
