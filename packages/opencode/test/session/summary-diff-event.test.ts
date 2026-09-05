/**
 * Regression test for the sidebar "Modified Files" bug: `SessionSummary.summarize`
 * used to publish the `session.diff` event with an empty array (`diff: []`), which
 * wiped the TUI/app sidebar diff on every completed turn. The real diffs were stored
 * on the message summary but never pushed to clients via the event.
 *
 * This test drives a real prompt through `SessionPrompt` (the production path that
 * fires `summarize`) and captures the published `session.diff` event. It asserts the
 * event carries the real merged diff — not `[]`. (We capture the event rather than
 * reading `sessions.diff`, which reads the message summary and would pass under both
 * the old and new code.)
 */
import { expect } from "bun:test"
import { Effect, Layer } from "effect"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import fs from "fs/promises"
import path from "path"
import { Session } from "../../src/session/session"
import { SessionPrompt } from "../../src/session/prompt"
import { MessageV2 } from "../../src/session/message-v2"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { Database } from "@opencode-ai/core/database/database"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { EventV2Bridge } from "../../src/event-v2-bridge"
import { provideTmpdirServer } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import { TestLLMServer } from "../lib/llm-server"
import { LSP } from "@/lsp/lsp"
import { MCP } from "../../src/mcp"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { RuntimeFlags } from "@/effect/runtime-flags"

const mcp = Layer.succeed(
  MCP.Service,
  MCP.Service.of({
    status: () => Effect.succeed({}),
    clients: () => Effect.succeed({}),
    instructions: () => Effect.succeed([]),
    tools: () => Effect.succeed({}),
    prompts: () => Effect.succeed({}),
    resources: () => Effect.succeed({}),
    resourceTemplates: () => Effect.succeed({}),
    add: () => Effect.succeed({ status: { status: "disabled" as const } }),
    connect: () => Effect.void,
    disconnect: () => Effect.void,
    getPrompt: () => Effect.succeed(undefined),
    readResource: () => Effect.succeed(undefined),
    startAuth: () => Effect.die("unexpected MCP auth"),
    authenticate: () => Effect.die("unexpected MCP auth"),
    finishAuth: () => Effect.die("unexpected MCP auth"),
    removeAuth: () => Effect.void,
    supportsOAuth: () => Effect.succeed(false),
    hasStoredTokens: () => Effect.succeed(false),
    getAuthStatus: () => Effect.succeed("not_authenticated" as const),
  }),
)

const lsp = Layer.succeed(
  LSP.Service,
  LSP.Service.of({
    init: () => Effect.void,
    status: () => Effect.succeed([]),
    hasClients: () => Effect.succeed(false),
    touchFile: () => Effect.void,
    diagnostics: () => Effect.succeed({}),
    hover: () => Effect.succeed(undefined),
    definition: () => Effect.succeed([]),
    references: () => Effect.succeed([]),
    implementation: () => Effect.succeed([]),
    documentSymbol: () => Effect.succeed([]),
    workspaceSymbol: () => Effect.succeed([]),
    prepareCallHierarchy: () => Effect.succeed([]),
    incomingCalls: () => Effect.succeed([]),
    outgoingCalls: () => Effect.succeed([]),
  }),
)

const root = LayerNode.group([
  SessionPrompt.node,
  Session.node,
  SessionProjector.node,
  EventV2Bridge.node,
  Database.node,
  CrossSpawnSpawner.node,
  LayerNode.make({ service: TestLLMServer, layer: TestLLMServer.layer, deps: [] }),
])
const it = testEffect(
  LayerNode.compile(root, [
    [MCP.node, mcp],
    [LSP.node, lsp],
    [RuntimeFlags.node, RuntimeFlags.layer({ experimentalEventSystem: true })],
  ]),
)

const providerCfg = (url: string) => ({
  provider: {
    test: {
      name: "Test",
      id: "test",
      env: [],
      npm: "@ai-sdk/openai-compatible",
      models: {
        "test-model": {
          id: "test-model",
          name: "Test Model",
          attachment: false,
          reasoning: false,
          temperature: false,
          tool_call: true,
          release_date: "2025-01-01",
          limit: { context: 100000, output: 10000 },
          cost: { input: 0, output: 0 },
          options: {},
        },
      },
      options: {
        apiKey: "test-key",
        baseURL: url,
      },
    },
  },
})

it.live("publishes the real merged diff in the session.diff event", () =>
  provideTmpdirServer(
    Effect.fnUntraced(function* ({ dir, llm }) {
      const prompt = yield* SessionPrompt.Service
      const sessions = yield* Session.Service
      const events = yield* EventV2Bridge.Service

      // Seed a file so the agent's edit shows up as a modification.
      yield* Effect.promise(() => fs.writeFile(path.join(dir, "a.txt"), "hi\n"))

      const session = yield* sessions.create({
        title: "sidebar diff regression",
        permission: [{ permission: "*", pattern: "*", action: "allow" }],
      })

      const captured: Array<{ sessionID: string; diff: Array<{ file: string }> }> = []
      const unsub = yield* events.listen((event) =>
        Effect.gen(function* () {
          if (event.type === "session.diff")
            captured.push(event.data as { sessionID: string; diff: Array<{ file: string }> })
          return
        }),
      )

      const command = `printf 'world\\n' >> ${path.join(dir, "a.txt")}`
      yield* llm.toolMatch((hit) => JSON.stringify(hit.body).includes("append"), "bash", { command })
      yield* llm.textMatch((hit) => JSON.stringify(hit.body).includes("bash"), "done")

      yield* prompt.prompt({
        sessionID: session.id,
        agent: "build",
        noReply: true,
        parts: [{ type: "text", text: "append a line to a.txt" }],
      })
      const result = yield* prompt.loop({ sessionID: session.id })
      expect(result.info.role).toBe("assistant")

      // summarize() is fire-and-forget; poll for the published event.
      let last: { sessionID: string; diff: Array<{ file: string }> } | undefined
      for (let i = 0; i < 50; i++) {
        last = captured.filter((c) => c.sessionID === session.id).at(-1)
        if (last && last.diff.length > 0) break
        yield* Effect.sleep("100 millis")
      }

      yield* unsub

      expect(last).toBeDefined()
      expect(last!.diff.length).toBeGreaterThan(0)
      expect(last!.diff.some((d) => d.file.includes("a.txt"))).toBe(true)

      // Sanity: the file was actually edited.
      const content = yield* Effect.promise(() => fs.readFile(path.join(dir, "a.txt"), "utf8"))
      expect(content).toBe("hi\nworld\n")
    }),
    { git: true, config: providerCfg },
  ),
)
