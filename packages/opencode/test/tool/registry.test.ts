import { afterEach, describe, expect } from "bun:test"
import path from "path"
import fs from "fs/promises"
import { Effect, Layer } from "effect"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { ToolRegistry } from "@/tool/registry"
import { Flag } from "@opencode-ai/core/flag/flag"
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
import { Git } from "@/git"
import { LSP } from "@/lsp/lsp"
import { Instruction } from "@/session/instruction"
import { Bus } from "@/bus"
import { FetchHttpClient } from "effect/unstable/http"
import { Format } from "@/format"
import { Ripgrep } from "@/file/ripgrep"
import * as Truncate from "@/tool/truncate"
import { InstanceState } from "@/effect/instance-state"
import { ProviderID, ModelID } from "@/provider/schema"
import { SessionID, MessageID } from "@/session/schema"
import type { Config } from "@/config/config"

const node = CrossSpawnSpawner.defaultLayer
const originalExperimentalScout = Flag.OPENCODE_EXPERIMENTAL_SCOUT
const originalClient = process.env.OPENCODE_CLIENT
const originalBridgeUrl = process.env.OPENCODE_INTEGRATED_BROWSER_TOOL_URL
const originalBridgeToken = process.env.OPENCODE_INTEGRATED_BROWSER_TOOL_TOKEN
let currentConfig: Partial<Config.Info> = {}
const configLayer = TestConfig.layer({
  get: () => Effect.succeed(currentConfig),
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
  Layer.provide(Git.defaultLayer),
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
  Flag.OPENCODE_EXPERIMENTAL_SCOUT = originalExperimentalScout
  currentConfig = {}
  process.env.OPENCODE_CLIENT = originalClient
  process.env.OPENCODE_INTEGRATED_BROWSER_TOOL_URL = originalBridgeUrl
  process.env.OPENCODE_INTEGRATED_BROWSER_TOOL_TOKEN = originalBridgeToken
  await disposeAllInstances()
})

function enableDesktopBridge(url = "http://127.0.0.1:3000", token = "test-token") {
  process.env.OPENCODE_CLIENT = "desktop"
  process.env.OPENCODE_INTEGRATED_BROWSER_TOOL_URL = url
  process.env.OPENCODE_INTEGRATED_BROWSER_TOOL_TOKEN = token
  currentConfig = { browser: { integratedTools: { enabled: true } } }
}

function modelInput() {
  const agent: Agent.Info = { name: "build", mode: "primary", permission: [], options: {} }
  return {
    providerID: ProviderID.opencode,
    modelID: ModelID.make("test-model"),
    agent,
  }
}

describe("tool.registry", () => {
  it.instance("hides repo research tools unless experimental", () =>
    Effect.gen(function* () {
      Flag.OPENCODE_EXPERIMENTAL_SCOUT = false
      const registry = yield* ToolRegistry.Service
      const ids = yield* registry.ids()

      expect(ids).not.toContain("codesearch")
      expect(ids).not.toContain("repo_clone")
      expect(ids).not.toContain("repo_overview")
    }),
  )

  it.instance("shows repo research tools when experimental scout is enabled", () =>
    Effect.gen(function* () {
      Flag.OPENCODE_EXPERIMENTAL_SCOUT = true
      const registry = yield* ToolRegistry.Service
      const ids = yield* registry.ids()

      expect(ids).toContain("codesearch")
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

  it.instance("registers integrated browser tools only for desktop with the setting enabled and bridge available", () =>
    Effect.gen(function* () {
      enableDesktopBridge()
      const registry = yield* ToolRegistry.Service
      const enabled = (yield* registry.tools(modelInput())).map((tool) => tool.id)

      const browserToolIds = enabled.filter((id) => id.startsWith("browser_"))

      expect(browserToolIds).toEqual([
        "browser_navigate",
        "browser_inspect",
        "browser_click",
        "browser_type",
        "browser_screenshot",
        "browser_console_messages",
        "browser_console_clear",
        "browser_back",
        "browser_forward",
        "browser_reload",
      ])
      expect(browserToolIds.every((id) => /^[a-zA-Z0-9_-]+$/.test(id))).toBe(true)
      expect(enabled).not.toContain("browser.navigate")
      expect(enabled).not.toContain("browser.inspect")

      currentConfig = { browser: { integratedTools: { enabled: false } } }
      expect((yield* registry.tools(modelInput())).map((tool) => tool.id)).not.toContain("browser_navigate")

      currentConfig = { browser: { integratedTools: { enabled: true } } }
      process.env.OPENCODE_CLIENT = "cli"
      expect((yield* registry.tools(modelInput())).map((tool) => tool.id)).not.toContain("browser_navigate")

      process.env.OPENCODE_CLIENT = "desktop"
      delete process.env.OPENCODE_INTEGRATED_BROWSER_TOOL_URL
      expect((yield* registry.tools(modelInput())).map((tool) => tool.id)).not.toContain("browser_navigate")
    }),
  )

  it.instance("registers integrated browser tools for loopback bridge hosts", () =>
    Effect.gen(function* () {
      const registry = yield* ToolRegistry.Service

      for (const host of ["127.0.0.1", "localhost", "[::1]"]) {
        enableDesktopBridge(`http://${host}:3000`)
        expect((yield* registry.tools(modelInput())).map((tool) => tool.id)).toContain("browser_navigate")
      }
    }),
  )

  it.instance("does not register integrated browser tools for non-loopback bridge hosts", () =>
    Effect.gen(function* () {
      const registry = yield* ToolRegistry.Service

      for (const url of ["http://example.com/tool", "http://192.168.1.10:3000"]) {
        enableDesktopBridge(url, "bridge-token-must-not-leak")
        expect((yield* registry.tools(modelInput())).map((tool) => tool.id)).not.toContain("browser_navigate")
      }
    }),
  )

  it.instance("executes integrated browser tools through the localhost bridge", () =>
    Effect.gen(function* () {
      const requests: Array<{ url: string; authorization: string | null; body: unknown }> = []
      const server = Bun.serve({
        hostname: "127.0.0.1",
        port: 0,
        async fetch(request) {
          requests.push({
            url: new URL(request.url).pathname,
            authorization: request.headers.get("authorization"),
            body: await request.json(),
          })
          return Response.json({ ok: true, result: { ok: true, navigated: true } })
        },
      })
      try {
        enableDesktopBridge(`http://127.0.0.1:${server.port}`, "bridge-token")
        const registry = yield* ToolRegistry.Service
        const navigate = (yield* registry.tools(modelInput())).find((tool) => tool.id === "browser_navigate")
        if (!navigate) throw new Error("browser_navigate was not registered")

        const result = yield* navigate.execute(
          { url: "https://opencode.ai", browserId: "browser-1" },
          {
            sessionID: SessionID.descending(),
            messageID: MessageID.ascending(),
            agent: "build",
            abort: new AbortController().signal,
            messages: [],
            metadata: () => Effect.void,
            ask: () => Effect.void,
          },
        )

        expect(result.output).toContain('"navigated": true')
        expect(requests).toEqual([
          {
            url: "/tool",
            authorization: "Bearer bridge-token",
            body: {
              tool: "browser_navigate",
              input: { url: "https://opencode.ai", browserId: "browser-1" },
            },
          },
        ])
      } finally {
        server.stop(true)
      }
    }),
  )
})
