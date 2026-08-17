import { ConfigV1 } from "@opencode-ai/core/v1/config/config"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { Database } from "@opencode-ai/core/database/database"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { AutoSummaryStore } from "@opencode-ai/core/session/auto-summary-store"
import { EventV2Bridge } from "@/event-v2-bridge"
import { expect } from "bun:test"
import { Effect, Layer } from "effect"
import path from "path"
import { Agent as AgentSvc } from "../../src/agent/agent"
import { BackgroundJob } from "@/background/job"
import { Command } from "../../src/command"
import { Config } from "@/config/config"
import { LSP } from "@/lsp/lsp"
import { MCP } from "../../src/mcp"
import { Permission } from "../../src/permission"
import { Plugin } from "../../src/plugin"
import { Provider as ProviderSvc } from "@/provider/provider"
import { Env } from "../../src/env"
import { Git } from "../../src/git"
import { Image } from "../../src/image/image"

import { Question } from "../../src/question"
import { Todo } from "../../src/session/todo"
import { Session } from "@/session/session"
import { LLM } from "../../src/session/llm"
import { MessageV2 } from "../../src/session/message-v2"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { SessionCompaction } from "../../src/session/compaction"
import { SessionSummary } from "../../src/session/summary"
import { SessionAutoSummary } from "../../src/session/auto-summary"
import { Instruction } from "../../src/session/instruction"
import { SessionProcessor } from "../../src/session/processor"
import { SessionPrompt } from "../../src/session/prompt"
import { SessionRevert } from "../../src/session/revert"
import { SessionRunState } from "../../src/session/run-state"
import { MessageID, PartID, SessionID } from "../../src/session/schema"
import { SessionStatus } from "../../src/session/status"
import { Skill } from "../../src/skill"
import { SystemPrompt } from "../../src/session/system"
import { Snapshot } from "../../src/snapshot"
import { ToolRegistry } from "@/tool/registry"
import { Truncate } from "@/tool/truncate"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Ripgrep } from "@opencode-ai/core/ripgrep"
import { Format } from "../../src/format"
import { TestInstance } from "../fixture/fixture"
import { pollWithTimeout, testEffect } from "../lib/effect"
import { reply, TestLLMServer } from "../lib/llm-server"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ModelV2 } from "@opencode-ai/core/model"

const summary = Layer.succeed(
  SessionSummary.Service,
  SessionSummary.Service.of({
    summarize: () => Effect.void,
    diff: () => Effect.succeed([]),
    computeDiff: () => Effect.succeed([]),
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
    startAuth: () => Effect.die("unexpected MCP auth in summarizer tests"),
    authenticate: () => Effect.die("unexpected MCP auth in summarizer tests"),
    finishAuth: () => Effect.die("unexpected MCP auth in summarizer tests"),
    removeAuth: () => Effect.void,
    supportsOAuth: () => Effect.succeed(false),
    hasStoredTokens: () => Effect.succeed(false),
    getAuthStatus: () => Effect.succeed("not_authenticated" as const),
  }),
)

const runtimeFlags = RuntimeFlags.layer({ experimentalEventSystem: true })

const testLLMServerNode = LayerNode.make({ service: TestLLMServer, layer: TestLLMServer.layer, deps: [] })

const it = testEffect(
  LayerNode.compile(
    LayerNode.group([
      SessionPrompt.node,
      Session.node,
      SessionProjector.node,
      MessageV2.node,
      Snapshot.node,
      LLM.node,
      Env.node,
      AgentSvc.node,
      Command.node,
      Permission.node,
      Plugin.node,
      Config.node,
      ProviderSvc.node,
      LSP.node,
      MCP.node,
      FSUtil.node,
      BackgroundJob.node,
      SessionStatus.node,
      SessionRunState.node,
      Database.node,
      EventV2Bridge.node,
      Question.node,
      Todo.node,
      ToolRegistry.node,
      Skill.node,
      Git.node,
      Ripgrep.node,
      Format.node,
      Truncate.node,
      SessionProcessor.node,
      Image.node,
      SessionCompaction.node,
      SessionRevert.node,
      Instruction.node,
      SystemPrompt.node,
      CrossSpawnSpawner.node,
      RuntimeFlags.node,
      SessionAutoSummary.node,
      AutoSummaryStore.node,
      testLLMServerNode,
    ]),
    [
      [SessionSummary.node, summary],
      [LSP.node, lsp],
      [MCP.node, mcp],
      [RuntimeFlags.node, runtimeFlags],
    ],
  ),
)

const ref = {
  providerID: ProviderV2.ID.make("test"),
  modelID: ModelV2.ID.make("test-model"),
}

function providerCfg(url: string): Partial<ConfigV1.Info> {
  return {
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
  }
}

const useServerConfig = Effect.fn("test.useServerConfig")(function* () {
  const { directory: dir } = yield* TestInstance
  const llm = yield* TestLLMServer
  const fs = yield* FSUtil.Service
  yield* fs.writeWithDirs(
    path.join(dir, "opencode.json"),
    JSON.stringify({ $schema: "https://opencode.ai/config.json", ...providerCfg(llm.url) }),
  )
  return llm
})

const user = Effect.fn("test.user")(function* (sessionID: SessionID, agent: string, text: string) {
  const session = yield* Session.Service
  const msg = yield* session.updateMessage({
    id: MessageID.ascending(),
    role: "user",
    sessionID,
    agent,
    model: ref,
    time: { created: Date.now() },
  })
  yield* session.updatePart({
    id: PartID.ascending(),
    messageID: msg.id,
    sessionID,
    type: "text",
    text,
  })
  return msg
})

const assistant = Effect.fn("test.assistant")(function* (
  sessionID: SessionID,
  parentID: MessageID,
  agent: string,
  text: string,
) {
  const session = yield* Session.Service
  const msg: SessionV1.Assistant = {
    id: MessageID.ascending(),
    role: "assistant",
    parentID,
    sessionID,
    mode: agent,
    agent,
    cost: 0,
    path: { cwd: "/tmp", root: "/tmp" },
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    modelID: ref.modelID,
    providerID: ref.providerID,
    time: { created: Date.now() },
  }
  yield* session.updateMessage(msg)
  yield* session.updatePart({
    id: PartID.ascending(),
    messageID: msg.id,
    sessionID,
    type: "text",
    text,
  })
  return msg
})

const seedTurn = Effect.fn("test.seedTurn")(function* (
  sessionID: SessionID,
  agent: string,
  question: string,
  answer: string,
) {
  const u = yield* user(sessionID, agent, question)
  yield* assistant(sessionID, u.id, agent, answer)
})

// The session-summarizer agent prompt becomes the first system message of the
// request, so its wording identifies summarizer hits on the test server.
const SUMMARIZER = "running summary of a coding session"
const isSummarizer = (hit: { body: unknown }) => JSON.stringify(hit.body).includes(SUMMARIZER)

const summarizerHits = Effect.gen(function* () {
  const llm = yield* TestLLMServer
  const hits = yield* llm.hits
  return hits.filter(isSummarizer)
})

const waitForSummary = (sessionID: SessionID, text?: string) =>
  pollWithTimeout(
    Effect.gen(function* () {
      const store = yield* AutoSummaryStore.Service
      const row = yield* store.get(sessionID)
      if (!row) return undefined
      if (text && row.summary !== text) return undefined
      return row
    }),
    `session ${sessionID} summary never became "${text ?? "written"}"`,
    "5 seconds",
  )

it.instance(
  "updates the summary when an auto turn completes",
  () =>
    Effect.gen(function* () {
      const llm = yield* useServerConfig()
      const prompt = yield* SessionPrompt.Service
      const sessions = yield* Session.Service
      const chat = yield* sessions.create({})

      yield* llm.text("world")
      yield* llm.pushMatch(isSummarizer, reply().text("SUMMARY_ONE").stop())
      yield* prompt.prompt({
        sessionID: chat.id,
        agent: "auto",
        parts: [{ type: "text", text: "hello" }],
      })

      const row = yield* waitForSummary(chat.id)
      expect(row.summary).toBe("SUMMARY_ONE")
      expect(row.model).toBe("test/test-model")
      expect(row.turnCount).toBe(1)
      expect(yield* summarizerHits).toHaveLength(1)
    }),
  15_000,
)

it.instance(
  "never calls the summarizer outside auto mode",
  () =>
    Effect.gen(function* () {
      const llm = yield* useServerConfig()
      const prompt = yield* SessionPrompt.Service
      const store = yield* AutoSummaryStore.Service
      const sessions = yield* Session.Service
      const chat = yield* sessions.create({})

      yield* llm.text("world")
      yield* prompt.prompt({
        sessionID: chat.id,
        agent: "build",
        parts: [{ type: "text", text: "hello" }],
      })
      // The summarizer fork runs after the loop exits; give it room to (not) fire.
      yield* Effect.sleep("500 millis")

      expect(yield* summarizerHits).toHaveLength(0)
      expect(yield* store.get(chat.id)).toBeUndefined()
    }),
  15_000,
)

it.instance(
  "sends the previous summary plus the new turn on later turns",
  () =>
    Effect.gen(function* () {
      const llm = yield* useServerConfig()
      const prompt = yield* SessionPrompt.Service
      const store = yield* AutoSummaryStore.Service
      const sessions = yield* Session.Service
      const chat = yield* sessions.create({})

      yield* llm.text("reply one")
      yield* llm.pushMatch(isSummarizer, reply().text("SUMMARY_ONE").stop())
      yield* prompt.prompt({
        sessionID: chat.id,
        agent: "auto",
        parts: [{ type: "text", text: "first question" }],
      })
      yield* waitForSummary(chat.id, "SUMMARY_ONE")

      yield* llm.text("reply two")
      yield* llm.pushMatch(isSummarizer, reply().text("SUMMARY_TWO").stop())
      yield* prompt.prompt({
        sessionID: chat.id,
        agent: "auto",
        parts: [{ type: "text", text: "second question" }],
      })
      yield* waitForSummary(chat.id, "SUMMARY_TWO")

      const hits = yield* summarizerHits
      expect(hits).toHaveLength(2)
      const body = JSON.stringify(hits[1]?.body)
      expect(body).toContain("SUMMARY_ONE")
      expect(body).toContain("second question")
      // The assistant tail of the last summarized turn rides along for continuity.
      expect(body).toContain("reply one")
      expect(body).not.toContain("first question")
      expect((yield* store.get(chat.id))?.turnCount).toBe(2)
    }),
  15_000,
)

it.instance(
  "catch-up summarizes the whole history of a session without a summary",
  () =>
    Effect.gen(function* () {
      const llm = yield* useServerConfig()
      const auto = yield* SessionAutoSummary.Service
      const sessions = yield* Session.Service
      const chat = yield* sessions.create({})
      yield* seedTurn(chat.id, "build", "first question", "reply one")
      yield* seedTurn(chat.id, "build", "second question", "reply two")

      yield* llm.pushMatch(isSummarizer, reply().text("CATCH_UP").stop())
      yield* auto.ensure(chat.id)

      const row = yield* waitForSummary(chat.id)
      expect(row.summary).toBe("CATCH_UP")
      expect(row.model).toBe("test/test-model")
      expect(row.turnCount).toBe(2)
      const hits = yield* summarizerHits
      expect(hits).toHaveLength(1)
      const body = JSON.stringify(hits[0]?.body)
      expect(body).toContain("first question")
      expect(body).toContain("second question")

      // ensure is a no-op once a summary exists
      yield* auto.ensure(chat.id)
      yield* Effect.sleep("300 millis")
      expect(yield* summarizerHits).toHaveLength(1)
    }),
  15_000,
)

it.instance(
  "catch-up re-runs when the stored summary is behind the history",
  () =>
    Effect.gen(function* () {
      const llm = yield* useServerConfig()
      const auto = yield* SessionAutoSummary.Service
      const store = yield* AutoSummaryStore.Service
      const sessions = yield* Session.Service
      const chat = yield* sessions.create({})
      yield* seedTurn(chat.id, "build", "first question", "reply one")
      yield* seedTurn(chat.id, "auto", "second question", "reply two")
      yield* store.upsert({ sessionID: chat.id, summary: "STALE", model: "test/test-model", turnCount: 1 })

      yield* llm.pushMatch(isSummarizer, reply().text("FRESH").stop())
      yield* auto.ensure(chat.id)

      const row = yield* waitForSummary(chat.id, "FRESH")
      expect(row.turnCount).toBe(2)
      const hits = yield* summarizerHits
      expect(hits).toHaveLength(1)
      const body = JSON.stringify(hits[0]?.body)
      expect(body).toContain("STALE")
      expect(body).toContain("second question")
      expect(body).not.toContain("first question")
    }),
  15_000,
)

it.instance(
  "serializes concurrent summary updates per session",
  () =>
    Effect.gen(function* () {
      const llm = yield* useServerConfig()
      const prompt = yield* SessionPrompt.Service
      const sessions = yield* Session.Service
      const chat = yield* sessions.create({})

      let release!: () => void
      const gate = new Promise<void>((resolve) => {
        release = resolve
      })

      yield* llm.text("reply one")
      yield* llm.pushMatch(isSummarizer, reply().wait(gate).text("SUMMARY_ONE").stop())
      yield* prompt.prompt({
        sessionID: chat.id,
        agent: "auto",
        parts: [{ type: "text", text: "first question" }],
      })
      yield* pollWithTimeout(
        Effect.gen(function* () {
          const hits = yield* summarizerHits
          return hits.length === 1 ? hits : undefined
        }),
        "first summarizer request never arrived",
        "5 seconds",
      )

      // The second turn's update must queue behind the held flight, not race
      // it — no second request may leave while the first is in flight.
      yield* llm.text("reply two")
      yield* llm.pushMatch(isSummarizer, reply().text("SUMMARY_TWO").stop())
      yield* prompt.prompt({
        sessionID: chat.id,
        agent: "auto",
        parts: [{ type: "text", text: "second question" }],
      })
      yield* Effect.sleep("500 millis")
      expect(yield* summarizerHits).toHaveLength(1)

      release()
      const row = yield* waitForSummary(chat.id, "SUMMARY_TWO")
      expect(row.turnCount).toBe(2)
      expect(yield* summarizerHits).toHaveLength(2)
    }),
  15_000,
)

it.instance(
  "never regresses the stored turnCount",
  () =>
    Effect.gen(function* () {
      yield* useServerConfig()
      const store = yield* AutoSummaryStore.Service
      const sessions = yield* Session.Service
      const chat = yield* sessions.create({})

      yield* store.upsert({ sessionID: chat.id, summary: "NEW", model: "test/test-model", turnCount: 2 })
      yield* store.upsert({ sessionID: chat.id, summary: "OLD", model: "test/test-model", turnCount: 1 })

      const row = yield* store.get(chat.id)
      expect(row?.summary).toBe("NEW")
      expect(row?.turnCount).toBe(2)
    }),
  15_000,
)

it.instance(
  "keeps the previous summary when the summarizer fails",
  () =>
    Effect.gen(function* () {
      const llm = yield* useServerConfig()
      const prompt = yield* SessionPrompt.Service
      const store = yield* AutoSummaryStore.Service
      const sessions = yield* Session.Service
      const chat = yield* sessions.create({})

      yield* llm.text("reply one")
      yield* llm.pushMatch(isSummarizer, reply().text("SUMMARY_ONE").stop())
      yield* prompt.prompt({
        sessionID: chat.id,
        agent: "auto",
        parts: [{ type: "text", text: "first question" }],
      })
      yield* waitForSummary(chat.id, "SUMMARY_ONE")

      // Two failures queued: covers a client-side retry if the SDK issues one.
      yield* llm.text("reply two")
      yield* llm.pushMatch(isSummarizer, reply().streamError("boom").item())
      yield* llm.pushMatch(isSummarizer, reply().streamError("boom").item())
      yield* prompt.prompt({
        sessionID: chat.id,
        agent: "auto",
        parts: [{ type: "text", text: "second question" }],
      })
      // Give the forked summarizer room to fail before asserting.
      yield* Effect.sleep("500 millis")

      const row = yield* store.get(chat.id)
      expect(row?.summary).toBe("SUMMARY_ONE")
      expect(row?.turnCount).toBe(1)
    }),
  15_000,
)
