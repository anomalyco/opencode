import { ConfigV1 } from "@opencode-ai/core/v1/config/config"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { Database } from "@opencode-ai/core/database/database"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { TitleHistoryStore } from "@opencode-ai/core/session/title-history-store"
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
import { TestLLMServer } from "../lib/llm-server"
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
    startAuth: () => Effect.die("unexpected MCP auth in title tests"),
    authenticate: () => Effect.die("unexpected MCP auth in title tests"),
    finishAuth: () => Effect.die("unexpected MCP auth in title tests"),
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
      TitleHistoryStore.node,
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

const user = Effect.fn("test.user")(function* (sessionID: SessionID, text: string) {
  const session = yield* Session.Service
  const msg = yield* session.updateMessage({
    id: MessageID.ascending(),
    role: "user",
    sessionID,
    agent: "build",
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

const seedAbortedFirstTurn = Effect.fn("test.seedAbortedFirstTurn")(function* (sessionID: SessionID) {
  const session = yield* Session.Service
  const first = yield* user(sessionID, "hello")
  const assistant: SessionV1.Assistant = {
    id: MessageID.ascending(),
    role: "assistant",
    parentID: first.id,
    sessionID,
    mode: "build",
    agent: "build",
    cost: 0,
    path: { cwd: "/tmp", root: "/tmp" },
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    modelID: ref.modelID,
    providerID: ref.providerID,
    time: { created: Date.now() },
  }
  yield* session.updateMessage(assistant)
  yield* session.updatePart({
    id: PartID.ascending(),
    messageID: assistant.id,
    sessionID,
    type: "text",
    text: "partial answer",
  })
  return yield* user(sessionID, "second turn")
})

const titleHits = Effect.gen(function* () {
  const llm = yield* TestLLMServer
  const hits = yield* llm.hits
  return hits.filter((hit) => JSON.stringify(hit.body).includes("Generate a title"))
})

const waitForTitle = (sessionID: SessionID, title: string) =>
  pollWithTimeout(
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const session = yield* sessions.get(sessionID)
      return session.title === title ? (true as const) : undefined
    }),
    `session ${sessionID} title never became "${title}"`,
    "5 seconds",
  )

it.instance(
  "writes the title once from the first user message",
  () =>
    Effect.gen(function* () {
      const llm = yield* useServerConfig()
      const prompt = yield* SessionPrompt.Service
      const sessions = yield* Session.Service
      const history = yield* TitleHistoryStore.Service
      const chat = yield* sessions.create({})

      yield* llm.text("world")
      yield* prompt.prompt({
        sessionID: chat.id,
        agent: "build",
        parts: [{ type: "text", text: "hello" }],
      })

      yield* waitForTitle(chat.id, "E2E Title")
      const rows = yield* history.listBySession(chat.id)
      expect(rows).toHaveLength(1)
      const msgs = yield* sessions.messages({ sessionID: chat.id })
      const userMsg = msgs.find((msg) => msg.info.role === "user")
      expect(rows[0]).toMatchObject({
        sessionID: chat.id,
        title: "E2E Title",
        source: "llm",
        model: "test/test-model",
        triggerMessageID: userMsg?.info.id,
      })
      expect(yield* titleHits).toHaveLength(1)
    }),
  15_000,
)

it.instance(
  "keeps the title stable on later turns",
  () =>
    Effect.gen(function* () {
      const llm = yield* useServerConfig()
      const prompt = yield* SessionPrompt.Service
      const sessions = yield* Session.Service
      const history = yield* TitleHistoryStore.Service
      const chat = yield* sessions.create({})

      yield* llm.text("world")
      yield* prompt.prompt({
        sessionID: chat.id,
        agent: "build",
        parts: [{ type: "text", text: "hello" }],
      })
      yield* waitForTitle(chat.id, "E2E Title")

      yield* llm.text("again")
      yield* prompt.prompt({
        sessionID: chat.id,
        agent: "build",
        parts: [{ type: "text", text: "more" }],
      })
      // The retitle fork runs at the first step of the turn; give it room to (not) fire.
      yield* Effect.sleep("500 millis")

      const session = yield* sessions.get(chat.id)
      expect(session.title).toBe("E2E Title")
      expect(yield* history.listBySession(chat.id)).toHaveLength(1)
      expect(yield* titleHits).toHaveLength(1)
    }),
  15_000,
)

it.instance(
  "titles the session on the next turn after an aborted first turn",
  () =>
    Effect.gen(function* () {
      const llm = yield* useServerConfig()
      const prompt = yield* SessionPrompt.Service
      const sessions = yield* Session.Service
      const history = yield* TitleHistoryStore.Service
      const chat = yield* sessions.create({})
      const second = yield* seedAbortedFirstTurn(chat.id)

      yield* llm.text("done")
      yield* prompt.loop({ sessionID: chat.id })

      yield* waitForTitle(chat.id, "E2E Title")
      const rows = yield* history.listBySession(chat.id)
      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({
        source: "llm",
        model: "test/test-model",
        triggerMessageID: second.id,
      })
      expect(yield* titleHits).toHaveLength(1)
    }),
  15_000,
)

it.instance(
  "never overwrites a user-renamed title",
  () =>
    Effect.gen(function* () {
      const llm = yield* useServerConfig()
      const prompt = yield* SessionPrompt.Service
      const sessions = yield* Session.Service
      const history = yield* TitleHistoryStore.Service
      const chat = yield* sessions.create({})
      yield* sessions.setTitle({ sessionID: chat.id, title: "User picked" })

      yield* llm.text("world")
      yield* prompt.prompt({
        sessionID: chat.id,
        agent: "build",
        parts: [{ type: "text", text: "hello" }],
      })
      // The retitle fork runs at the first step of the turn; give it room to (not) fire.
      yield* Effect.sleep("500 millis")

      const session = yield* sessions.get(chat.id)
      expect(session.title).toBe("User picked")
      const rows = yield* history.listBySession(chat.id)
      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({ title: "User picked", source: "user" })
      expect(yield* titleHits).toHaveLength(0)
    }),
  15_000,
)

it.instance(
  "a rename landing during title generation beats the llm retitle",
  () =>
    Effect.gen(function* () {
      yield* useServerConfig()
      const sessions = yield* Session.Service
      const history = yield* TitleHistoryStore.Service
      const chat = yield* sessions.create({})
      const initial = (yield* sessions.get(chat.id)).title

      // The write a retitle makes when the default title still holds wins.
      yield* sessions.setTitle({
        sessionID: chat.id,
        title: "Generated",
        source: "llm",
        model: "test/test-model",
        triggerMessageId: MessageID.ascending(),
        expectedTitle: initial,
      })
      expect((yield* sessions.get(chat.id)).title).toBe("Generated")

      yield* sessions.setTitle({ sessionID: chat.id, title: "User picked" })
      // The same retitle, landing after the rename, must lose outright: no
      // title change, no history row.
      yield* sessions.setTitle({
        sessionID: chat.id,
        title: "Late llm",
        source: "llm",
        model: "test/test-model",
        triggerMessageId: MessageID.ascending(),
        expectedTitle: initial,
      })

      expect((yield* sessions.get(chat.id)).title).toBe("User picked")
      const rows = yield* history.listBySession(chat.id)
      expect(rows).toHaveLength(2)
      expect(rows[0]).toMatchObject({ title: "Generated", source: "llm" })
      expect(rows[1]).toMatchObject({ title: "User picked", source: "user" })
    }),
  15_000,
)

it.instance(
  "records the source of each title write",
  () =>
    Effect.gen(function* () {
      yield* useServerConfig()
      const sessions = yield* Session.Service
      const history = yield* TitleHistoryStore.Service
      const chat = yield* sessions.create({})

      yield* sessions.setTitle({ sessionID: chat.id, title: "Manual rename" })
      yield* sessions.setTitle({
        sessionID: chat.id,
        title: "Generated",
        source: "llm",
        model: "openrouter/anthropic/claude-haiku-4.5",
        triggerMessageId: MessageID.ascending(),
      })

      const rows = yield* history.listBySession(chat.id)
      expect(rows).toHaveLength(2)
      expect(rows[0]).toMatchObject({ title: "Manual rename", source: "user", model: undefined })
      expect(rows[1]).toMatchObject({
        title: "Generated",
        source: "llm",
        model: "openrouter/anthropic/claude-haiku-4.5",
      })
      expect(rows[1]?.triggerMessageID).toBeDefined()
      expect(rows[0]?.createdAt).toEqual(expect.any(Number))
    }),
  15_000,
)
