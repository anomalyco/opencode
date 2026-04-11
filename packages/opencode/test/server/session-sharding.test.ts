import { afterEach, describe, expect, test } from "bun:test"
import { existsSync } from "fs"
import path from "path"
import { Effect, Layer } from "effect"
import { NodeFileSystem } from "@effect/platform-node"
import { FetchHttpClient } from "effect/unstable/http"
import { Instance } from "../../src/project/instance"
import { Server } from "../../src/server/server"
import { Session } from "../../src/session"
import { MessageV2 } from "../../src/session/message-v2"
import { MessageID, PartID, SessionID } from "../../src/session/schema"
import { Database, eq } from "../../src/storage/db"
import { MessageTable, PartTable, TodoTable } from "../../src/session/session.sql"
import { Log } from "../../src/util/log"
import { initProjectors } from "../../src/server/projectors"
import { tmpdir, provideTmpdirInstance, provideTmpdirServer } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import { TestLLMServer } from "../lib/llm-server"
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
import { Question } from "../../src/question"
import { Todo } from "../../src/session/todo"
import { LLM } from "../../src/session/llm"
import { AppFileSystem } from "@opencode-ai/shared/filesystem"
import { SessionCompaction } from "../../src/session/compaction"
import { Instruction } from "../../src/session/instruction"
import { SessionProcessor } from "../../src/session/processor"
import { SessionPrompt } from "../../src/session/prompt"
import { SessionSummary } from "../../src/session/summary"
import { SessionRevert } from "../../src/session/revert"
import { SessionRunState } from "../../src/session/run-state"
import { SessionStatus } from "../../src/session/status"
import { SystemPrompt } from "../../src/session/system"
import { Skill } from "../../src/skill"
import { Snapshot } from "../../src/snapshot"
import { Format } from "../../src/format"
import { ToolRegistry } from "../../src/tool/registry"
import { Truncate } from "../../src/tool/truncate"
import * as CrossSpawnSpawner from "../../src/effect/cross-spawn-spawner"
import { Ripgrep } from "../../src/file/ripgrep"

Log.init({ print: false })
initProjectors()

afterEach(async () => {
  await Instance.disposeAll()
  Database.close()
})

async function msg(sid: SessionID, text: string) {
  const id = MessageID.ascending()
  await Session.updateMessage({
    id,
    sessionID: sid,
    role: "user",
    time: { created: Date.now() },
    agent: "test",
    model: { providerID: ProviderID.make("test"), modelID: ModelID.make("test") },
    tools: {},
  } satisfies MessageV2.User)
  await Session.updatePart({
    id: PartID.ascending(),
    sessionID: sid,
    messageID: id,
    type: "text",
    text,
  })
  return id
}

describe("sharding via serve API", () => {
  test("new session creates shard file", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const app = Server.Default().app
        const res = await app.request("/session", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({}),
        })
        expect(res.status).toBe(200)
        const session = (await res.json()) as { id: string }
        expect(session.id).toMatch(/^ses_/)

        const file = path.join(Database.sessionDir, session.id + ".db")
        expect(existsSync(file)).toBe(true)

        await Session.remove(session.id as SessionID)
      },
    })
  })

  test("messages written to shard are readable via API", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const id = await msg(session.id, "shard-routed")
        const app = Server.Default().app

        const res = await app.request(`/session/${session.id}/message`)
        expect(res.status).toBe(200)
        const body = (await res.json()) as MessageV2.WithParts[]
        expect(body).toHaveLength(1)
        expect(body[0]!.info.id).toBe(id)

        const shard = Database.session(session.id)
        const global = Database.Client()
        const in_shard = shard.select({ id: MessageTable.id }).from(MessageTable).where(eq(MessageTable.id, id)).get()
        const in_global = global.select({ id: MessageTable.id }).from(MessageTable).where(eq(MessageTable.id, id)).get()
        expect(in_shard?.id).toBe(id)
        expect(in_global).toBeUndefined()

        await Session.remove(session.id)
      },
    })
  })

  test("child session has no shard file", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const parent = await Session.create({})
        const app = Server.Default().app

        const res = await app.request("/session", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ parentID: parent.id }),
        })
        expect(res.status).toBe(200)
        const child = (await res.json()) as { id: string }

        const file = path.join(Database.sessionDir, child.id + ".db")
        expect(existsSync(file)).toBe(false)

        await Session.remove(child.id as SessionID)
        await Session.remove(parent.id)
      },
    })
  })

  test("child messages route through parent shard", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const parent = await Session.create({})
        const child = await Session.create({ parentID: parent.id })
        const id = await msg(child.id, "child-msg")

        const shard = Database.session(parent.id)
        const row = shard.select({ id: MessageTable.id }).from(MessageTable).where(eq(MessageTable.id, id)).get()
        expect(row?.id).toBe(id)

        const app = Server.Default().app
        const res = await app.request(`/session/${child.id}/message`)
        expect(res.status).toBe(200)
        const body = (await res.json()) as MessageV2.WithParts[]
        expect(body).toHaveLength(1)

        await Session.remove(child.id)
        await Session.remove(parent.id)
      },
    })
  })

  test("session list includes sharded sessions", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const s1 = await Session.create({})
        const s2 = await Session.create({})

        const sessions = [...Session.list({ directory: tmp.path })]
        const ids = sessions.map((s) => s.id)
        expect(ids).toContain(s1.id)
        expect(ids).toContain(s2.id)
        expect(existsSync(path.join(Database.sessionDir, s1.id + ".db"))).toBe(true)
        expect(existsSync(path.join(Database.sessionDir, s2.id + ".db"))).toBe(true)

        await Session.remove(s1.id)
        await Session.remove(s2.id)
      },
    })
  })
})

describe("getPart shard routing", () => {
  test("resolveSession routes to shard for tool parts", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const mid = MessageID.ascending()
        const pid = PartID.ascending()

        await Session.updateMessage({
          id: mid,
          sessionID: session.id,
          role: "assistant",
          parentID: MessageID.ascending(),
          providerID: ProviderID.make("test"),
          modelID: ModelID.make("test"),
          path: { cwd: tmp.path, root: tmp.path },
          cost: 0,
          tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          time: { created: Date.now() },
          agent: "test",
          mode: "",
        } satisfies MessageV2.Assistant)

        await Session.updatePart({
          id: pid,
          sessionID: session.id,
          messageID: mid,
          type: "tool",
          tool: "bash",
          callID: "call_test",
          state: { status: "pending", input: {}, raw: "" },
        } as unknown as MessageV2.Part)

        const shard = Database.session(session.id)
        const in_shard = shard.select().from(PartTable).where(eq(PartTable.id, pid)).get()
        expect(in_shard).toBeDefined()

        const global = Database.Client()
        const in_global = global.select().from(PartTable).where(eq(PartTable.id, pid)).get()
        expect(in_global).toBeUndefined()

        const resolved = Database.resolveSession(session.id)
        const via_resolve = resolved.select().from(PartTable).where(eq(PartTable.id, pid)).get()
        expect(via_resolve).toBeDefined()
        expect(via_resolve?.id).toBe(pid)

        await Session.remove(session.id)
      },
    })
  })
})

describe("sweep marker via serve API", () => {
  test("orphan messages in global are swept into shard on first access", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        await msg(session.id, "normal")

        const src = Database.Client().$client
        const now = Date.now()
        src
          .query("INSERT INTO message (id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?)")
          .run(MessageID.ascending(), session.id, now, now, JSON.stringify({ role: "user", text: "orphan" }))

        Database.closeSession(session.id)
        Database.resetSwept()

        const app = Server.Default().app
        const res = await app.request(`/session/${session.id}/message`)
        expect(res.status).toBe(200)
        const body = (await res.json()) as MessageV2.WithParts[]
        expect(body).toHaveLength(2)

        await Session.remove(session.id)
      },
    })
  })

  test("marker prevents redundant sweep on second access", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})

        const src = Database.Client().$client
        src
          .query("INSERT INTO message (id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?)")
          .run(
            MessageID.ascending(),
            session.id,
            Date.now(),
            Date.now(),
            JSON.stringify({ role: "user", text: "orphan" }),
          )

        Database.closeSession(session.id)
        Database.resetSwept()
        Database.ensureShard(session.id)

        Database.closeSession(session.id)
        Database.resetSwept()
        const before = performance.now()
        Database.ensureShard(session.id)
        const elapsed = performance.now() - before
        expect(elapsed).toBeLessThan(50)

        await Session.remove(session.id)
      },
    })
  })
})

function toolPart(parts: MessageV2.Part[]) {
  return parts.find((part): part is MessageV2.ToolPart => part.type === "tool")
}

type CompletedToolPart = MessageV2.ToolPart & { state: MessageV2.ToolStateCompleted }

function completedTool(parts: MessageV2.Part[]) {
  const part = toolPart(parts)
  expect(part?.state.status).toBe("completed")
  return part?.state.status === "completed" ? (part as CompletedToolPart) : undefined
}

const mcpStub = Layer.succeed(
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
    startAuth: () => Effect.die("unexpected MCP auth in shard tests"),
    authenticate: () => Effect.die("unexpected MCP auth in shard tests"),
    finishAuth: () => Effect.die("unexpected MCP auth in shard tests"),
    removeAuth: () => Effect.void,
    supportsOAuth: () => Effect.succeed(false),
    hasStoredTokens: () => Effect.succeed(false),
    getAuthStatus: () => Effect.succeed("not_authenticated" as const),
  }),
)

const lspStub = Layer.succeed(
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
    withLock: (_filepath, fn) => fn(),
  }),
)

const status = SessionStatus.layer.pipe(Layer.provideMerge(Bus.layer))
const run = SessionRunState.layer.pipe(Layer.provide(status))
const infra = Layer.mergeAll(NodeFileSystem.layer, CrossSpawnSpawner.defaultLayer)

function makeHttp() {
  const deps = Layer.mergeAll(
    Session.defaultLayer,
    Snapshot.defaultLayer,
    LLM.defaultLayer,
    AgentSvc.defaultLayer,
    Command.defaultLayer,
    Permission.defaultLayer,
    Plugin.defaultLayer,
    Config.defaultLayer,
    ProviderSvc.defaultLayer,
    Format.defaultLayer,
    filetime,
    lspStub,
    mcpStub,
    AppFileSystem.defaultLayer,
    status,
    SessionSummary.defaultLayer,
    SystemPrompt.defaultLayer,
  ).pipe(Layer.provideMerge(infra))
  const question = Question.layer.pipe(Layer.provideMerge(deps))
  const todo = Todo.layer.pipe(Layer.provideMerge(deps))
  const registry = ToolRegistry.layer.pipe(
    Layer.provide(Skill.defaultLayer),
    Layer.provide(FetchHttpClient.layer),
    Layer.provide(CrossSpawnSpawner.defaultLayer),
    Layer.provide(Ripgrep.defaultLayer),
    Layer.provideMerge(todo),
    Layer.provideMerge(question),
    Layer.provideMerge(deps),
  )
  const trunc = Truncate.layer.pipe(Layer.provideMerge(deps))
  const proc = SessionProcessor.layer.pipe(Layer.provideMerge(deps))
  const compact = SessionCompaction.layer.pipe(Layer.provideMerge(proc), Layer.provideMerge(deps))
  return Layer.mergeAll(
    TestLLMServer.layer,
    SessionPrompt.layer.pipe(
      Layer.provide(SessionRevert.defaultLayer),
      Layer.provideMerge(run),
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

const cfg = {
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
        baseURL: "http://localhost:1/v1",
      },
    },
  },
}

function providerCfg(url: string) {
  return {
    ...cfg,
    provider: {
      ...cfg.provider,
      test: {
        ...cfg.provider.test,
        options: {
          ...cfg.provider.test.options,
          baseURL: url,
        },
      },
    },
  }
}

const boot = Effect.fn("test.boot")(function* () {
  const prompt = yield* SessionPrompt.Service
  const sessions = yield* Session.Service
  const chat = yield* sessions.create({
    title: "Shard Test",
    permission: [{ permission: "*", pattern: "*", action: "allow" }],
  })
  return { prompt, sessions, chat }
})

describe("shard isolation via Effect integration", () => {
  it.live(
    "tool execution via shell writes to shard not global",
    () =>
      provideTmpdirInstance(
        () =>
          Effect.gen(function* () {
            const { prompt, chat } = yield* boot()
            const result = yield* prompt.shell({
              sessionID: chat.id,
              agent: "build",
              command: "echo SHARD_TOOL_TEST",
            })

            const tool = completedTool(result.parts)
            expect(tool).toBeDefined()
            if (!tool) return

            expect(tool.state.output).toContain("SHARD_TOOL_TEST")

            const shard = Database.session(chat.id)
            const in_shard = shard.select({ id: PartTable.id }).from(PartTable).where(eq(PartTable.id, tool.id)).get()
            expect(in_shard?.id).toBe(tool.id)

            const global = Database.Client()
            const in_global = global.select({ id: PartTable.id }).from(PartTable).where(eq(PartTable.id, tool.id)).get()
            expect(in_global).toBeUndefined()
          }),
        { git: true, config: cfg },
      ),
    30_000,
  )

  it.live(
    "tool state transitions show completed status with input and output",
    () =>
      provideTmpdirInstance(
        () =>
          Effect.gen(function* () {
            const { prompt, chat } = yield* boot()
            const result = yield* prompt.shell({
              sessionID: chat.id,
              agent: "build",
              command: "echo STATE_OK",
            })

            const tool = completedTool(result.parts)
            expect(tool).toBeDefined()
            if (!tool) return

            expect(tool.state.status).toBe("completed")
            expect(tool.state.input.command).toContain("echo STATE_OK")
            expect(tool.state.output).toContain("STATE_OK")
          }),
        { git: true, config: cfg },
      ),
    30_000,
  )

  it.live(
    "full prompt flow writes messages to shard not global",
    () =>
      provideTmpdirServer(
        Effect.fnUntraced(function* ({ llm }) {
          const prompt = yield* SessionPrompt.Service
          const sessions = yield* Session.Service
          const chat = yield* sessions.create({
            title: "Shard Prompt",
            permission: [{ permission: "*", pattern: "*", action: "allow" }],
          })
          yield* prompt.prompt({
            sessionID: chat.id,
            agent: "build",
            noReply: true,
            parts: [{ type: "text", text: "shard prompt test" }],
          })
          yield* llm.text("shard response")

          const result = yield* prompt.loop({ sessionID: chat.id })
          expect(result.info.role).toBe("assistant")

          const shard = Database.session(chat.id)
          const msgs = shard.select({ id: MessageTable.id }).from(MessageTable).all()
          expect(msgs.length).toBeGreaterThanOrEqual(2)

          const global = Database.Client()
          const in_global = global
            .select({ id: MessageTable.id })
            .from(MessageTable)
            .where(eq(MessageTable.session_id, chat.id))
            .all()
          expect(in_global).toHaveLength(0)
        }),
        { git: true, config: providerCfg },
      ),
    30_000,
  )

  it.live(
    "todo writes go to shard not global",
    () =>
      provideTmpdirInstance(
        () =>
          Effect.gen(function* () {
            const sessions = yield* Session.Service
            const todo = yield* Todo.Service
            const chat = yield* sessions.create({ title: "Todo Shard" })

            yield* todo.update({
              sessionID: chat.id,
              todos: [
                { content: "first task", status: "pending", priority: "high" },
                { content: "second task", status: "in_progress", priority: "medium" },
              ],
            })

            const shard = Database.session(chat.id)
            const in_shard = shard.select().from(TodoTable).where(eq(TodoTable.session_id, chat.id)).all()
            expect(in_shard).toHaveLength(2)
            expect(in_shard[0]!.content).toBe("first task")
            expect(in_shard[1]!.content).toBe("second task")

            const global = Database.Client()
            const in_global = global.select().from(TodoTable).where(eq(TodoTable.session_id, chat.id)).all()
            expect(in_global).toHaveLength(0)

            const fetched = yield* todo.get(chat.id)
            expect(fetched).toHaveLength(2)
            expect(fetched[0]!.content).toBe("first task")
            expect(fetched[1]!.content).toBe("second task")
          }),
        { git: true, config: cfg },
      ),
    30_000,
  )
})
