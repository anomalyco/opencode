/**
 * Reproduction test for e2e LLM URL routing.
 *
 * Tests whether OPENCODE_E2E_LLM_URL correctly routes LLM calls
 * to the mock server when no explicit provider config is set.
 * This mimics the e2e `project` fixture path (vs. withMockOpenAI).
 */
import { expect } from "bun:test"
import { Effect, Layer } from "effect"
import { Session } from "../../src/session"
import { SessionPrompt } from "../../src/session/prompt"
import { SessionSummary } from "../../src/session/summary"
import { Log } from "../../src/util/log"
import { provideTmpdirServer } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import { TestLLMServer } from "../lib/llm-server"

import { NodeFileSystem } from "@effect/platform-node"
import { Agent as AgentSvc } from "../../src/agent/agent"
import { Bus } from "../../src/bus"
import { Command } from "../../src/command"
import { Config } from "../../src/config/config"
import { FileTime } from "../../src/file/time"
import { LSP } from "../../src/lsp"
import { MCP } from "../../src/mcp"
import { Permission } from "../../src/permission"
import { Plugin } from "../../src/plugin"
import { Provider as ProviderSvc } from "../../src/provider/provider"
import { ModelID, ProviderID } from "../../src/provider/schema"
import { Server } from "../../src/server/server"
import { SessionCompaction } from "../../src/session/compaction"
import { Instruction } from "../../src/session/instruction"
import { SessionProcessor } from "../../src/session/processor"
import { SessionStatus } from "../../src/session/status"
import { LLM } from "../../src/session/llm"
import { Shell } from "../../src/shell/shell"
import { Snapshot } from "../../src/snapshot"
import { ToolRegistry } from "../../src/tool/registry"
import { Truncate } from "../../src/tool/truncate"
import { AppFileSystem } from "../../src/filesystem"
import * as CrossSpawnSpawner from "../../src/effect/cross-spawn-spawner"

Log.init({ print: false })

const mcp = Layer.succeed(
  MCP.Service,
  MCP.Service.of({
    status: () => Effect.succeed({}),
    clients: () => Effect.succeed({}),
    tools: () => Effect.succeed({}),
    prompts: () => Effect.succeed({}),
    resources: () => Effect.succeed({}),
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

const filetime = Layer.succeed(
  FileTime.Service,
  FileTime.Service.of({
    read: () => Effect.void,
    get: () => Effect.succeed(undefined),
    assert: () => Effect.void,
    withLock: (_filepath, fn) => Effect.promise(fn),
  }),
)

const status = SessionStatus.layer.pipe(Layer.provideMerge(Bus.layer))
const infra = Layer.mergeAll(NodeFileSystem.layer, CrossSpawnSpawner.defaultLayer)
const patchModel = { providerID: ProviderID.make("openai"), modelID: ModelID.make("gpt-5.4") } as const

function makeHttp() {
  const deps = Layer.mergeAll(
    Session.defaultLayer,
    Snapshot.defaultLayer,
    LLM.defaultLayer,
    AgentSvc.defaultLayer,
    Command.defaultLayer,
    Permission.layer,
    Plugin.defaultLayer,
    Config.defaultLayer,
    ProviderSvc.defaultLayer,
    filetime,
    lsp,
    mcp,
    AppFileSystem.defaultLayer,
    status,
  ).pipe(Layer.provideMerge(infra))
  const registry = ToolRegistry.layer.pipe(Layer.provideMerge(deps))
  const trunc = Truncate.layer.pipe(Layer.provideMerge(deps))
  const proc = SessionProcessor.layer.pipe(Layer.provideMerge(deps))
  const compact = SessionCompaction.layer.pipe(Layer.provideMerge(proc), Layer.provideMerge(deps))
  return Layer.mergeAll(
    TestLLMServer.layer,
    SessionPrompt.layer.pipe(
      Layer.provideMerge(compact),
      Layer.provideMerge(proc),
      Layer.provideMerge(registry),
      Layer.provideMerge(trunc),
      Layer.provide(Instruction.defaultLayer),
      Layer.provideMerge(deps),
    ),
  )
}

const it = testEffect(makeHttp())

it.live("e2eURL routes apply_patch through mock server", () =>
  provideTmpdirServer(
    Effect.fnUntraced(function* ({ dir, llm }) {
      // Set the env var to route all LLM calls through the mock
      const prev = process.env.OPENCODE_E2E_LLM_URL
      process.env.OPENCODE_E2E_LLM_URL = llm.url
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          if (prev === undefined) delete process.env.OPENCODE_E2E_LLM_URL
          else process.env.OPENCODE_E2E_LLM_URL = prev
        }),
      )

      const prompt = yield* SessionPrompt.Service
      const sessions = yield* Session.Service

      const session = yield* sessions.create({
        title: "e2e url test",
        permission: [{ permission: "*", pattern: "*", action: "allow" }],
      })

      const patch = ["*** Begin Patch", "*** Add File: e2e-test.txt", "+line 1", "+line 2", "*** End Patch"].join("\n")

      // Queue mock response: match on system prompt, return apply_patch tool call
      yield* llm.toolMatch(
        (hit) => JSON.stringify(hit.body).includes("Your only valid response is one apply_patch tool call"),
        "apply_patch",
        { patchText: patch },
      )
      // After tool execution, LLM gets called again with tool result — return "done"
      yield* llm.text("done")

      // Seed user message
      yield* prompt.prompt({
        sessionID: session.id,
        agent: "build",
        model: patchModel,
        noReply: true,
        system: [
          "You are seeding deterministic e2e UI state.",
          "Your only valid response is one apply_patch tool call.",
          `Use this JSON input: ${JSON.stringify({ patchText: patch })}`,
          "Do not call any other tools.",
          "Do not output plain text.",
        ].join("\n"),
        parts: [{ type: "text", text: "Apply the provided patch exactly once." }],
      })

      // Run the agent loop
      const result = yield* prompt.loop({ sessionID: session.id })
      expect(result.info.role).toBe("assistant")

      const calls = yield* llm.calls
      expect(calls).toBe(2)

      const missed = yield* llm.misses
      expect(missed.length).toBe(0)

      const content = yield* Effect.promise(() =>
        Bun.file(`${dir}/e2e-test.txt`)
          .text()
          .catch(() => "NOT FOUND"),
      )
      expect(content).toContain("line 1")

      let diff: Awaited<ReturnType<typeof SessionSummary.diff>> = []
      for (let i = 0; i < 20; i++) {
        diff = yield* Effect.promise(() => SessionSummary.diff({ sessionID: session.id }))
        if (diff.length > 0) break
        yield* Effect.sleep("100 millis")
      }
      expect(diff.length).toBeGreaterThan(0)
    }),
    {
      git: true,
      config: () => ({
        model: "openai/gpt-5.4",
        agent: {
          build: {
            model: "openai/gpt-5.4",
          },
        },
        provider: {
          openai: {
            options: {
              apiKey: "test-openai-key",
            },
          },
        },
      }),
    },
  ),
)

it.live("server message route produces diff through mock server", () =>
  provideTmpdirServer(
    Effect.fnUntraced(function* ({ dir, llm }) {
      const prev = process.env.OPENCODE_E2E_LLM_URL
      process.env.OPENCODE_E2E_LLM_URL = llm.url
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          if (prev === undefined) delete process.env.OPENCODE_E2E_LLM_URL
          else process.env.OPENCODE_E2E_LLM_URL = prev
        }),
      )

      const sessions = yield* Session.Service
      const session = yield* sessions.create({
        title: "e2e route test",
        permission: [{ permission: "*", pattern: "*", action: "allow" }],
      })
      const app = Server.Default()
      const patch = ["*** Begin Patch", "*** Add File: route-test.txt", "+line 1", "+line 2", "*** End Patch"].join(
        "\n",
      )

      yield* llm.toolMatch(
        (hit) => JSON.stringify(hit.body).includes("Your only valid response is one apply_patch tool call"),
        "apply_patch",
        { patchText: patch },
      )
      yield* llm.text("done")

      const res = yield* Effect.promise(() =>
        Promise.resolve(
          app.request(`/session/${session.id}/message`, {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "x-opencode-directory": dir,
            },
            body: JSON.stringify({
              agent: "build",
              system: [
                "You are seeding deterministic e2e UI state.",
                "Your only valid response is one apply_patch tool call.",
                `Use this JSON input: ${JSON.stringify({ patchText: patch })}`,
                "Do not call any other tools.",
                "Do not output plain text.",
              ].join("\n"),
              parts: [{ type: "text", text: "Apply the provided patch exactly once." }],
            }),
          }),
        ),
      )
      expect(res.status).toBe(200)
      yield* Effect.promise(() => res.json())

      const calls = yield* llm.calls
      expect(calls).toBe(2)

      const content = yield* Effect.promise(() =>
        Bun.file(`${dir}/route-test.txt`)
          .text()
          .catch(() => "NOT FOUND"),
      )
      expect(content).toContain("line 1")

      let diff: Awaited<ReturnType<typeof SessionSummary.diff>> = []
      for (let i = 0; i < 30; i++) {
        diff = yield* Effect.promise(() => SessionSummary.diff({ sessionID: session.id }))
        if (diff.length > 0) break
        yield* Effect.sleep("100 millis")
      }

      expect(diff.length).toBeGreaterThan(0)
    }),
    {
      git: true,
      config: () => ({
        model: "openai/gpt-5.4",
        agent: { build: { model: "openai/gpt-5.4" } },
        provider: { openai: { options: { apiKey: "test-openai-key" } } },
      }),
    },
  ),
)
