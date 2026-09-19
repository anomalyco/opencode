import { SessionV1 } from "@opencode-ai/core/v1/session"
import { ConfigV1 } from "@opencode-ai/core/v1/config/config"
import { Database } from "@opencode-ai/core/database/database"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { describe, expect } from "bun:test"
import { Effect, Fiber, Layer } from "effect"
import path from "path"
import { pathToFileURL } from "url"
import { Agent as AgentSvc } from "../../src/agent/agent"
import { BackgroundJob } from "@/background/job"
import { Command } from "../../src/command"
import { Config } from "@/config/config"
import { EventV2Bridge } from "@/event-v2-bridge"
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
import { Shell } from "@opencode-ai/core/shell"
import { Snapshot } from "../../src/snapshot"
import { ToolRegistry } from "@/tool/registry"
import { Truncate } from "@/tool/truncate"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Ripgrep } from "@opencode-ai/core/ripgrep"
import { Format } from "../../src/format"
import { TestInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import { TestLLMServer, raw } from "../lib/llm-server"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ModelV2 } from "@opencode-ai/core/model"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"

const summary = Layer.succeed(
  SessionSummary.Service,
  SessionSummary.Service.of({
    summarize: () => Effect.void,
    diff: () => Effect.succeed([]),
    computeDiff: () => Effect.succeed([]),
  }),
)

const ref = {
  providerID: ProviderV2.ID.make("test"),
  modelID: ModelV2.ID.make("test-model"),
}

function makeMcp() {
  return Layer.succeed(MCP.Service, MCP.Service.of({
    status: () => Effect.succeed({}),
    clients: () => Effect.succeed({}),
    instructions: () => Effect.succeed([]),
    tools: () => Effect.succeed({}),
    prompts: () => Effect.succeed({}),
    resources: () => Effect.succeed({}),
    resourceTemplates: () => Effect.succeed({}),
    add: () => Effect.succeed({ status: { status: "disabled" as const } }),
    connect: (_name: string) => Effect.succeed({ status: "connected" as const }),
    disconnect: (_name: string) => Effect.void,
    getPrompt: (_name: string, _promptName: string) => Effect.succeed(undefined),
    readResource: (_uri: string) => Effect.succeed(undefined),
    startAuth: () => Effect.die("unexpected MCP auth in session-stopping tests"),
    authenticate: () => Effect.die("unexpected MCP auth in session-stopping tests"),
    finishAuth: () => Effect.die("unexpected MCP auth in session-stopping tests") as any,
    removeAuth: () => Effect.void,
    supportsOAuth: () => Effect.succeed(false),
    hasStoredTokens: () => Effect.succeed(false),
    getAuthStatus: () => Effect.succeed("not_authenticated" as const),
  }))
}

const lsp = Layer.succeed(LSP.Service, LSP.Service.of({
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
}))

const runtimeFlags = RuntimeFlags.layer({ experimentalEventSystem: true })
const testLLMServerNode = LayerNode.make({ service: TestLLMServer, layer: TestLLMServer.layer, deps: [] })

const promptRoot = LayerNode.group([
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
])

function makeHttp() {
  const root = LayerNode.group([promptRoot, testLLMServerNode])
  const replacements = [
    [SessionSummary.node, summary],
    [LSP.node, lsp],
    [MCP.node, makeMcp()],
    [RuntimeFlags.node, runtimeFlags],
  ] as const
  return LayerNode.compile(root, replacements)
}

const it = testEffect(makeHttp())

const writeText = Effect.fn("test.writeText")(function* (file: string, text: string) {
  const fs = yield* FSUtil.Service
  yield* fs.writeWithDirs(file, text)
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

const seed = Effect.fn("test.seed")(function* (sessionID: SessionID, opts?: { finish?: string }) {
  const session = yield* Session.Service
  const msg = yield* user(sessionID, "hello")
  const assistant: SessionV1.Assistant = {
    id: MessageID.ascending(),
    role: "assistant",
    parentID: msg.id,
    sessionID,
    mode: "build",
    agent: "build",
    cost: 0,
    path: { cwd: "/tmp", root: "/tmp" },
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    modelID: ref.modelID,
    providerID: ref.providerID,
    time: { created: Date.now() },
    ...(opts?.finish ? { finish: opts.finish } : {}),
  }
  yield* session.updateMessage(assistant)
  yield* session.updatePart({
    id: PartID.ascending(),
    messageID: assistant.id,
    sessionID,
    type: "text",
    text: "hi there",
  })
  return { user: msg, assistant }
})

const BASE_CFG: ConfigV1.Info = {
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

function providerCfg(url: string): ConfigV1.Info {
  return {
    ...BASE_CFG,
    provider: {
      test: {
        ...BASE_CFG.provider!.test,
        options: {
          ...BASE_CFG.provider!.test.options,
          baseURL: url,
        },
      },
    },
  }
}

const waitForBusy = (sessionID: SessionID) =>
  Effect.gen(function* () {
    const status = yield* SessionStatus.Service
    while (true) {
      const s = yield* status.get(sessionID)
      if (s.type === "busy") return true as const
      yield* Effect.sleep("20 millis")
    }
  }).pipe(Effect.timeoutOrElse({ duration: "2 seconds", orElse: () => Effect.die("session never became busy") }))

describe("session.stopping exit-matrix", () => {
  it.instance("natural-exit seeded assistant fires hook — loop exits normally",
    () =>
      Effect.gen(function* () {
        const { directory: dir } = yield* TestInstance
        const prompt = yield* SessionPrompt.Service
        const sessions = yield* Session.Service
        const chat = yield* sessions.create({ title: "Pooled exit test" })
        const marker = path.join(dir, "stopping-count")

        yield* seed(chat.id, { finish: "stop" })
        const result = yield* prompt.loop({ sessionID: chat.id })
        expect(result.info.role).toBe("assistant")

        const countText = yield* Effect.promise(() => Bun.file(marker).text())
        expect(countText).toBe("fire")
      }),
    {
      git: true,
      init: (dir) =>
        Effect.gen(function* () {
          const marker = path.join(dir, "stopping-count")
          yield* writeText(
            path.join(dir, "plugin.ts"),
            [
              "export default async () => ({",
              `  "session.stopping": async (_input, output) => {`,
              `    await Bun.write(${JSON.stringify(marker)}, 'fire')`,
              "  },",
              "})",
              "",
            ].join("\n"),
          )
          yield* writeText(
            path.join(dir, "opencode.json"),
            JSON.stringify({
              $schema: "https://opencode.ai/config.json",
              ...BASE_CFG,
              plugin: [pathToFileURL(path.join(dir, "plugin.ts")).href],
            }),
          )
        }),
    },
  )

  it.instance("cancel (non-natural) does NOT fire stopping hook",
    () =>
      Effect.gen(function* () {
        const { directory: dir } = yield* TestInstance
        const prompt = yield* SessionPrompt.Service
        const sessions = yield* Session.Service
        const marker = path.join(dir, "stopping-fired")

        const chat = yield* sessions.create({})
        yield* user(chat.id, "hello")
        const fiber = yield* prompt.loop({ sessionID: chat.id }).pipe(Effect.forkChild)
        yield* waitForBusy(chat.id) as Effect.Effect<true, never, never>
        yield* prompt.cancel(chat.id)
        yield* Fiber.await(fiber).pipe(
          Effect.timeoutOrElse({ duration: "5 seconds", orElse: () => Effect.die("cancelled loop never exited") }),
        )

        const exists = yield* Effect.promise(async () => Bun.file(marker).exists())
        expect(exists).toBe(false)
      }),
    {
      git: true,
      init: (dir) =>
        Effect.gen(function* () {
          const marker = path.join(dir, "stopping-fired")
          yield* writeText(
            path.join(dir, "plugin.ts"),
            [
              "export default async () => ({",
              `  "session.stopping": async (_input) => {`,
              `    await Bun.write(${JSON.stringify(marker)}, 'fired')`,
              "  },",
              "})",
              "",
            ].join("\n"),
          )
          yield* writeText(
            path.join(dir, "opencode.json"),
            JSON.stringify({
              $schema: "https://opencode.ai/config.json",
              ...BASE_CFG,
              plugin: [pathToFileURL(path.join(dir, "plugin.ts")).href],
            }),
          )
        }),
    },
  )

  it.instance("continuation message persists and re-entry is bounded by the cap",
    () =>
      Effect.gen(function* () {
        const { directory: dir } = yield* TestInstance
        const prompt = yield* SessionPrompt.Service
        const sessions = yield* Session.Service
        const llm = yield* TestLLMServer

        const chat = yield* sessions.create({
          title: "cap test",
          permission: [{ permission: "*", pattern: "*", action: "allow" }],
        })
        yield* user(chat.id, "hello")
        yield* llm.text("one")
        yield* llm.text("two")
        yield* llm.text("three")
        yield* llm.text("four")

        // Loop must terminate (bounded re-entry) rather than run forever.
        const result = yield* prompt.loop({ sessionID: chat.id }).pipe(
          Effect.timeoutOrElse({
            duration: "20 seconds",
            orElse: () => Effect.die("loop did not terminate; re-entry cap failed"),
          }),
        )
        expect(result.info.role).toBe("assistant")

        // Boundedness: exactly 4 LLM turns (1 initial + 3 continuations), not infinite.
        const msgs = yield* sessions.messages({ sessionID: chat.id })
        const assistants = msgs.filter((m) => m.info.role === "assistant")
        expect(assistants).toHaveLength(4)

        // Hook fired on every natural completion: initial + 3 continuations + 1 cap stop.
        const countText = yield* Effect.promise(() => Bun.file(path.join(dir, "stopping-count")).text())
        expect(Number(countText)).toBe(4)

        // SH-4 persistence contract: exactly 3 continuation messages survive,
        // each an ordinary user message with a single text part.
        const injected = msgs.filter(
          (m) => m.info.role === "user" && m.parts.some((p) => p.type === "text" && p.text === "keep going"),
        )
        expect(injected).toHaveLength(3)
        for (const msg of injected) {
          expect(msg.info.role).toBe("user")
          expect(msg.info.sessionID).toBe(chat.id)
          expect(msg.info.agent).toBe("build")
          expect(msg.parts).toHaveLength(1)
          expect(msg.parts[0].type).toBe("text")
          expect((msg.parts[0] as SessionV1.TextPart).text).toBe("keep going")
        }
        // No duplicate ids; the three injected messages are distinct records.
        expect(new Set(injected.map((m) => m.info.id)).size).toBe(3)

        // ── SH-4 ordering + metadata + attribution ────────────────────────
        // The injected continuation is an ordinary user message created through
        // the same store path as a real prompt; its metadata must be populated
        // consistently with the session's other user messages.
        const ordinary = msgs.filter((m) => m.info.role === "user" && m.info.id !== injected[0]!.info.id)
        expect(ordinary.length).toBeGreaterThan(0)
        const injectedIds = new Set(injected.map((m) => m.info.id))
        for (const msg of injected) {
          expect(msg.info.role).toBe("user")
          expect(msg.info.sessionID).toBe(chat.id)
          const injectedInfo = msg.info as SessionV1.User
          expect(injectedInfo.model).toBeDefined()
          if (injectedInfo.model) {
            expect(injectedInfo.model.providerID).toBe(ref.providerID)
            expect(injectedInfo.model.modelID).toBe(ref.modelID)
          }
          expect(typeof msg.info.time.created).toBe("number")
          // Attribution: the part is bound to the injected message, like any
          // other persisted user part.
          expect(msg.parts[0].messageID).toBe(msg.info.id)
        }
        // Ordering + attribution: each injected message must be positioned
        // strictly between the assistant turn that triggered the stop and the
        // next assistant turn, and the following assistant must be parented to
        // the injected message (the loop continued FROM that message).
        const withIndex = msgs.map((m) => m.info).map((info) => info.id)
        for (const msg of injected) {
          const idx = withIndex.indexOf(msg.info.id)
          expect(idx).toBeGreaterThan(0)
          expect(idx).toBeLessThan(withIndex.length - 1)
          const prev = msgs[idx - 1]!
          const next = msgs[idx + 1]!
          if (next.info.role === "assistant") {
            expect(next.info.parentID).toBe(msg.info.id)
          }
          // metadata consistency with the triggering/following assistant too
          expect(prev.info.sessionID).toBe(chat.id)
          expect(next.info.sessionID).toBe(chat.id)
          expect(next.info.role).toBe("assistant")
        }
        expect(injectedIds.size).toBe(3)
      }),
    {
      git: true,
      init: (dir) =>
        Effect.gen(function* () {
          const llm = yield* TestLLMServer
          const marker = path.join(dir, "stopping-count")
          yield* writeText(
            path.join(dir, "plugin.ts"),
            [
              "export default async () => ({",
              `  "session.stopping": async (_input, output) => {`,
              "    const n = await Bun.file(" + JSON.stringify(marker) + ").text().catch(() => '0')",
              "    await Bun.write(" + JSON.stringify(marker) + ", String(Number(n) + 1))",
              "    output.stop = false",
              '    output.message = "keep going"',
              "  },",
              "})",
              "",
            ].join("\n"),
          )
          yield* writeText(
            path.join(dir, "opencode.json"),
            JSON.stringify({
              $schema: "https://opencode.ai/config.json",
              ...providerCfg(llm.url),
              plugin: [pathToFileURL(path.join(dir, "plugin.ts")).href],
            }),
          )
        }),
    },
  )

  it.instance("repeated loop invocation cannot reset the per-session cap",
    () =>
      Effect.gen(function* () {
        const { directory: dir } = yield* TestInstance
        const prompt = yield* SessionPrompt.Service
        const sessions = yield* Session.Service
        const llm = yield* TestLLMServer

        const chat = yield* sessions.create({
          title: "repeated cap",
          permission: [{ permission: "*", pattern: "*", action: "allow" }],
        })
        yield* user(chat.id, "hello")
        yield* llm.text("one")
        yield* llm.text("two")
        yield* llm.text("three")
        yield* llm.text("four")

        yield* prompt.loop({ sessionID: chat.id }).pipe(
          Effect.timeoutOrElse({
            duration: "20 seconds",
            orElse: () => Effect.die("first loop did not terminate"),
          }),
        )
        // Cap exhausted: 3 continuations consumed.
        const before = yield* sessions.messages({ sessionID: chat.id })
        const injectedBefore = before.filter(
          (m) => m.info.role === "user" && m.parts.some((p) => p.type === "text" && p.text === "keep going"),
        )
        expect(injectedBefore).toHaveLength(3)

        // A second loop invocation on the SAME session must NOT reset the
        // counter: the 4th natural completion is still refused (no persist,
        // no new continuation message). The loop surfaces the finished
        // assistant and stops.
        yield* llm.text("five")
        yield* prompt.loop({ sessionID: chat.id }).pipe(
          Effect.timeoutOrElse({
            duration: "20 seconds",
            orElse: () => Effect.die("second loop did not terminate"),
          }),
        )
        const after = yield* sessions.messages({ sessionID: chat.id })
        const injectedAfter = after.filter(
          (m) => m.info.role === "user" && m.parts.some((p) => p.type === "text" && p.text === "keep going"),
        )
        expect(injectedAfter).toHaveLength(3)
      }),
    {
      git: true,
      init: (dir) =>
        Effect.gen(function* () {
          const llm = yield* TestLLMServer
          const marker = path.join(dir, "stopping-count")
          yield* writeText(
            path.join(dir, "plugin.ts"),
            [
              "export default async () => ({",
              `  "session.stopping": async (_input, output) => {`,
              "    const n = await Bun.file(" + JSON.stringify(marker) + ").text().catch(() => '0')",
              "    await Bun.write(" + JSON.stringify(marker) + ", String(Number(n) + 1))",
              "    output.stop = false",
              '    output.message = "keep going"',
              "  },",
              "})",
              "",
            ].join("\n"),
          )
          yield* writeText(
            path.join(dir, "opencode.json"),
            JSON.stringify({
              $schema: "https://opencode.ai/config.json",
              ...providerCfg(llm.url),
              plugin: [pathToFileURL(path.join(dir, "plugin.ts")).href],
            }),
          )
        }),
    },
  )

  it.instance("provider error (non-natural) does NOT fire stopping hook",
    () =>
      Effect.gen(function* () {
        const { directory: dir } = yield* TestInstance
        const prompt = yield* SessionPrompt.Service
        const sessions = yield* Session.Service
        const llm = yield* TestLLMServer
        const marker = path.join(dir, "stopping-fired")

        const chat = yield* sessions.create({
          title: "provider error",
          permission: [{ permission: "*", pattern: "*", action: "allow" }],
        })
        yield* user(chat.id, "hello")
        yield* llm.error(400, { error: { message: "contradiction", type: "invalid_request" } })

        const exit = yield* prompt.loop({ sessionID: chat.id }).pipe(
          Effect.timeoutOrElse({ duration: "20 seconds", orElse: () => Effect.die("loop did not terminate") }),
          Effect.exit,
        )
        void exit
        const exists = yield* Effect.promise(async () => Bun.file(marker).exists())
        expect(exists).toBe(false)
      }),
    {
      git: true,
      init: (dir) =>
        Effect.gen(function* () {
          const llm = yield* TestLLMServer
          const marker = path.join(dir, "stopping-fired")
          yield* writeText(
            path.join(dir, "plugin.ts"),
            [
              "export default async () => ({",
              `  "session.stopping": async (_input) => {`,
              `    await Bun.write(${JSON.stringify(marker)}, 'fired')`,
              "  },",
              "})",
              "",
            ].join("\n"),
          )
          yield* writeText(
            path.join(dir, "opencode.json"),
            JSON.stringify({
              $schema: "https://opencode.ai/config.json",
              ...providerCfg(llm.url),
              plugin: [pathToFileURL(path.join(dir, "plugin.ts")).href],
            }),
          )
        }),
    },
  )

  it.instance("retry (transient error then success) fires the hook exactly once",
    () =>
      Effect.gen(function* () {
        const { directory: dir } = yield* TestInstance
        const prompt = yield* SessionPrompt.Service
        const sessions = yield* Session.Service
        const llm = yield* TestLLMServer
        const marker = path.join(dir, "stopping-count")

        const chat = yield* sessions.create({
          title: "retry",
          permission: [{ permission: "*", pattern: "*", action: "allow" }],
        })
        yield* user(chat.id, "hello")
        // First attempt raises a retryable server error; SessionRetry retries and
        // the second attempt succeeds with a natural completion.
        yield* llm.error(500, { error: { message: "server error", type: "server" } })
        yield* llm.text("ok")

        const result = yield* prompt.loop({ sessionID: chat.id }).pipe(
          Effect.timeoutOrElse({ duration: "30 seconds", orElse: () => Effect.die("retry loop did not terminate") }),
        )
        expect(result.info.role).toBe("assistant")
        // Exactly one hook fire at the final natural completion — the transient
        // provider error during the retry never invoked a stopping callback.
        const countText = yield* Effect.promise(() => Bun.file(marker).text())
        expect(Number(countText)).toBe(1)
      }),
    {
      git: true,
      init: (dir) =>
        Effect.gen(function* () {
          const llm = yield* TestLLMServer
          const marker = path.join(dir, "stopping-count")
          yield* writeText(
            path.join(dir, "plugin.ts"),
            [
              "export default async () => ({",
              `  "session.stopping": async (_input, output) => {`,
              "    const n = await Bun.file(" + JSON.stringify(marker) + ").text().catch(() => '0')",
              "    await Bun.write(" + JSON.stringify(marker) + ", String(Number(n) + 1))",
              "  },",
              "})",
              "",
            ].join("\n"),
          )
          yield* writeText(
            path.join(dir, "opencode.json"),
            JSON.stringify({
              $schema: "https://opencode.ai/config.json",
              ...providerCfg(llm.url),
              plugin: [pathToFileURL(path.join(dir, "plugin.ts")).href],
            }),
          )
        }),
    },
  )

  it.instance("clean stop resets the per-session continuation budget",
    () =>
      Effect.gen(function* () {
        const { directory: dir } = yield* TestInstance
        const prompt = yield* SessionPrompt.Service
        const sessions = yield* Session.Service
        const llm = yield* TestLLMServer
        const decide = path.join(dir, "decide")
        const marker = path.join(dir, "stopping-count")

        yield* writeText(decide, "stop")
        const chat = yield* sessions.create({
          title: "clean stop reset",
          permission: [{ permission: "*", pattern: "*", action: "allow" }],
        })
        yield* user(chat.id, "hello")
        yield* llm.text("done")

        // First loop: the hook reads decide=stop and cleanly stops — no
        // continuation message is injected.
        yield* prompt.loop({ sessionID: chat.id }).pipe(
          Effect.timeoutOrElse({ duration: "20 seconds", orElse: () => Effect.die("clean loop did not terminate") }),
        )
        let injected = (yield* sessions.messages({ sessionID: chat.id })).filter(
          (m) => m.info.role === "user" && m.parts.some((p) => p.type === "text" && p.text === "keep going"),
        )
        expect(injected).toHaveLength(0)

        // Flip the decision to continue: a subsequent cleanly-stopped session
        // gets a FRESH budget (the counter was reset), so up to cap continuations
        // are allowed again.
        yield* writeText(decide, "continue")
        yield* llm.text("one")
        yield* llm.text("two")
        yield* llm.text("three")
        yield* llm.text("four")
        yield* llm.text("five")
        yield* prompt.loop({ sessionID: chat.id }).pipe(
          Effect.timeoutOrElse({ duration: "20 seconds", orElse: () => Effect.die("re-entry loop did not terminate") }),
        )
        const after = (yield* sessions.messages({ sessionID: chat.id })).filter(
          (m) => m.info.role === "user" && m.parts.some((p) => p.type === "text" && p.text === "keep going"),
        )
        expect(after).toHaveLength(3)
        void marker
      }),
    {
      git: true,
      init: (dir) =>
        Effect.gen(function* () {
          const llm = yield* TestLLMServer
          const decide = path.join(dir, "decide")
          const marker = path.join(dir, "stopping-count")
          yield* writeText(
            path.join(dir, "plugin.ts"),
            [
              "export default async () => ({",
              `  "session.stopping": async (_input, output) => {`,
              "    const n = await Bun.file(" + JSON.stringify(marker) + ").text().catch(() => '0')",
              "    await Bun.write(" + JSON.stringify(marker) + ", String(Number(n) + 1))",
              '    const decide2 = await Bun.file(' + JSON.stringify(decide) + ').text().catch(() => "stop")',
              '    if (decide2.trim() === "continue") {',
              "      output.stop = false",
              '      output.message = "keep going"',
              "    }",
              "  },",
              "})",
              "",
            ].join("\n"),
          )
          yield* writeText(
            path.join(dir, "opencode.json"),
            JSON.stringify({
              $schema: "https://opencode.ai/config.json",
              ...providerCfg(llm.url),
              plugin: [pathToFileURL(path.join(dir, "plugin.ts")).href],
            }),
          )
        }),
    },
  )

  it.instance("empty/whitespace continuation message treated as clean stop (no persist)",
    () =>
      Effect.gen(function* () {
        const { directory: dir } = yield* TestInstance
        const prompt = yield* SessionPrompt.Service
        const sessions = yield* Session.Service
        const llm = yield* TestLLMServer

        const chat = yield* sessions.create({
          title: "whitespace policy",
          permission: [{ permission: "*", pattern: "*", action: "allow" }],
        })
        yield* user(chat.id, "hello")
        yield* llm.text("one")
        const result = yield* prompt.loop({ sessionID: chat.id }).pipe(
          Effect.timeoutOrElse({ duration: "20 seconds", orElse: () => Effect.die("loop did not terminate") }),
        )
        expect(result.info.role).toBe("assistant")
        const msgs = yield* sessions.messages({ sessionID: chat.id })
        // No continuation persisted: an empty / whitespace-only message is not a
        // real continuation, so the session stops cleanly.
        const injected = msgs.filter((m) => m.info.role === "user" && m.parts.some((p) => p.type === "text"))
        expect(injected).toHaveLength(1) // original "hello" only
        expect(msgs.filter((m) => m.info.role === "assistant")).toHaveLength(1)
      }),
    {
      git: true,
      init: (dir) =>
        Effect.gen(function* () {
          const llm = yield* TestLLMServer
          yield* writeText(
            path.join(dir, "plugin.ts"),
            [
              "export default async () => ({",
              `  "session.stopping": async (_input, output) => {`,
              "    output.stop = false",
              '    output.message = "   "',
              "  },",
              "})",
              "",
            ].join("\n"),
          )
          yield* writeText(
            path.join(dir, "opencode.json"),
            JSON.stringify({
              $schema: "https://opencode.ai/config.json",
              ...providerCfg(llm.url),
              plugin: [pathToFileURL(path.join(dir, "plugin.ts")).href],
            }),
          )
        }),
    },
  )

  it.instance("two concurrent loop callers for one session consume a single continuation budget",
    () =>
      Effect.gen(function* () {
        const { directory: dir } = yield* TestInstance
        const prompt = yield* SessionPrompt.Service
        const sessions = yield* Session.Service
        const llm = yield* TestLLMServer

        const chat = yield* sessions.create({
          title: "concurrent callers",
          permission: [{ permission: "*", pattern: "*", action: "allow" }],
        })
        yield* user(chat.id, "hello")
        // Enough replies for one bounded cap journey (initial + 3 continuations).
        yield* llm.text("one")
        yield* llm.text("two")
        yield* llm.text("three")
        yield* llm.text("four")

        const [a, b] = yield* Effect.all([prompt.loop({ sessionID: chat.id }), prompt.loop({ sessionID: chat.id })], {
          concurrency: "unbounded",
        })
        expect(a.info.id).toBe(b.info.id)
        expect(a.info.role).toBe("assistant")

        // The continuation budget is per-session, so the two concurrent callers
        // together must not exceed a single cap's worth of continuations, and no
        // continuation is ever persisted twice.
        const msgs = yield* sessions.messages({ sessionID: chat.id })
        const injected = msgs.filter(
          (m) => m.info.role === "user" && m.parts.some((p) => p.type === "text" && p.text === "keep going"),
        )
        expect(injected).toHaveLength(3)
        expect(new Set(injected.map((m) => m.info.id)).size).toBe(3)
      }),
    {
      git: true,
      init: (dir) =>
        Effect.gen(function* () {
          const llm = yield* TestLLMServer
          const marker = path.join(dir, "stopping-count")
          yield* writeText(
            path.join(dir, "plugin.ts"),
            [
              "export default async () => ({",
              `  "session.stopping": async (_input, output) => {`,
              "    const n = await Bun.file(" + JSON.stringify(marker) + ").text().catch(() => '0')",
              "    await Bun.write(" + JSON.stringify(marker) + ", String(Number(n) + 1))",
              "    output.stop = false",
              '    output.message = "keep going"',
              "  },",
              "})",
              "",
            ].join("\n"),
          )
          yield* writeText(
            path.join(dir, "opencode.json"),
            JSON.stringify({
              $schema: "https://opencode.ai/config.json",
              ...providerCfg(llm.url),
              plugin: [pathToFileURL(path.join(dir, "plugin.ts")).href],
            }),
          )
        }),
    },
  )

  it.instance("SH-5 tool error exit (non-natural) does NOT fire stopping hook",
    () =>
      Effect.gen(function* () {
        const { directory: dir } = yield* TestInstance
        const prompt = yield* SessionPrompt.Service
        const sessions = yield* Session.Service
        const llm = yield* TestLLMServer
        const marker = path.join(dir, "stopping-fired")

        const chat = yield* sessions.create({
          title: "tool error",
          permission: [{ permission: "*", pattern: "*", action: "allow" }],
        })
        yield* user(chat.id, "hello")
        // The model calls a tool that errors, then the provider call fails.
        yield* llm.tool("read", { filePath: "/tmp/does-not-exist-xyz" })
        yield* llm.error(400, { error: { message: "boom", type: "invalid_request" } })

        const exit = yield* prompt.loop({ sessionID: chat.id }).pipe(
          Effect.timeoutOrElse({ duration: "20 seconds", orElse: () => Effect.die("loop did not terminate") }),
          Effect.exit,
        )
        const exists = yield* Effect.promise(async () => Bun.file(marker).exists())
        expect(exists).toBe(false)
        // The tool error exit is non-natural: the run ends on an errored turn,
        // never via a natural completion where the hook could fire.
        const msgs = yield* sessions.messages({ sessionID: chat.id })
        const last = msgs.at(-1)?.info
        if (!last) throw new Error("expected a persisted message")
        expect((last as any).error).toBeDefined()
        void exit
      }),
    {
      git: true,
      init: (dir) =>
        Effect.gen(function* () {
          const llm = yield* TestLLMServer
          const marker = path.join(dir, "stopping-fired")
          yield* writeText(path.join(dir, "plugin.ts"), `export default async () => ({ "session.stopping": async (_i) => { await Bun.write(${JSON.stringify(marker)}, 'fired') },})`)
          yield* writeText(path.join(dir, "opencode.json"), JSON.stringify({ $schema: "https://opencode.ai/config.json", ...providerCfg(llm.url), plugin: [pathToFileURL(path.join(dir, "plugin.ts")).href] }))
        }),
    },
  )

  it.instance("SH-5 compaction stop (non-natural) does NOT fire stopping hook",
    () =>
      Effect.gen(function* () {
        const { directory: dir } = yield* TestInstance
        const prompt = yield* SessionPrompt.Service
        const sessions = yield* Session.Service
        const compact = yield* SessionCompaction.Service
        const llm = yield* TestLLMServer
        const marker = path.join(dir, "stopping-fired")

        const chat = yield* sessions.create({
          title: "compact stop",
          permission: [{ permission: "*", pattern: "*", action: "allow" }],
        })
        yield* user(chat.id, "hello")
        yield* compact.create({ sessionID: chat.id, agent: "build", model: ref, auto: false })
        // The compaction summarizer errors, so the loop breaks at the compaction
        // stop without ever consulting the stopping hook.
        yield* llm.error(400, { error: { message: "compaction failed", type: "invalid_request" } })

        yield* prompt.loop({ sessionID: chat.id }).pipe(
          Effect.timeoutOrElse({ duration: "20 seconds", orElse: () => Effect.die("loop did not terminate") }),
          Effect.exit,
        )
        const exists = yield* Effect.promise(async () => Bun.file(marker).exists())
        expect(exists).toBe(false)
        const msgs = yield* sessions.messages({ sessionID: chat.id })
        expect(msgs.flatMap((m) => m.parts).some((p) => p.type === "compaction")).toBe(true)
      }),
    {
      git: true,
      init: (dir) =>
        Effect.gen(function* () {
          const llm = yield* TestLLMServer
          const marker = path.join(dir, "stopping-fired")
          yield* writeText(path.join(dir, "plugin.ts"), `export default async () => ({ "session.stopping": async (_i) => { await Bun.write(${JSON.stringify(marker)}, 'fired') },})`)
          yield* writeText(path.join(dir, "opencode.json"), JSON.stringify({ $schema: "https://opencode.ai/config.json", ...providerCfg(llm.url), plugin: [pathToFileURL(path.join(dir, "plugin.ts")).href] }))
        }),
    },
  )

  it.instance("SH-5 malformed provider response (non-natural) does NOT fire stopping hook",
    () =>
      Effect.gen(function* () {
        const { directory: dir } = yield* TestInstance
        const prompt = yield* SessionPrompt.Service
        const sessions = yield* Session.Service
        const llm = yield* TestLLMServer
        const marker = path.join(dir, "stopping-fired")

        const chat = yield* sessions.create({
          title: "malformed response",
          permission: [{ permission: "*", pattern: "*", action: "allow" }],
        })
        yield* user(chat.id, "hello")
        // The SDK cannot parse this chunk (content is a number), so the whole
        // turn errors out — a non-natural exit that must not consult the hook.
        yield* llm.push(raw({ chunks: [{ id: "x", object: "chat.completion.chunk", choices: [{ index: 0, delta: { content: 123 } }] }] }))

        yield* prompt.loop({ sessionID: chat.id }).pipe(
          Effect.timeoutOrElse({ duration: "20 seconds", orElse: () => Effect.die("loop did not terminate") }),
          Effect.exit,
        )
        const exists = yield* Effect.promise(async () => Bun.file(marker).exists())
        expect(exists).toBe(false)
        const msgs = yield* sessions.messages({ sessionID: chat.id })
        const last = msgs.at(-1)?.info
        expect((last as any).error).toBeDefined()
      }),
    {
      git: true,
      init: (dir) =>
        Effect.gen(function* () {
          const llm = yield* TestLLMServer
          const marker = path.join(dir, "stopping-fired")
          yield* writeText(path.join(dir, "plugin.ts"), `export default async () => ({ "session.stopping": async (_i) => { await Bun.write(${JSON.stringify(marker)}, 'fired') },})`)
          yield* writeText(path.join(dir, "opencode.json"), JSON.stringify({ $schema: "https://opencode.ai/config.json", ...providerCfg(llm.url), plugin: [pathToFileURL(path.join(dir, "plugin.ts")).href] }))
        }),
    },
  )

  it.instance("SH-5 nested session path attributes the stopping hook to the nested session, not the parent",
    () =>
      Effect.gen(function* () {
        const { directory: dir } = yield* TestInstance
        const prompt = yield* SessionPrompt.Service
        const sessions = yield* Session.Service
        const llm = yield* TestLLMServer
        const marker = path.join(dir, "stopping-fired")

        const parent = yield* sessions.create({
          title: "parent",
          permission: [{ permission: "*", pattern: "*", action: "allow" }],
        })
        const chat = yield* sessions.create({
          parentID: parent.id,
          title: "nested",
          permission: [{ permission: "*", pattern: "*", action: "allow" }],
        })
        yield* user(chat.id, "hello")
        yield* llm.text("one")

        // Running the nested (parentID-carrying) session completes naturally and
        // fires the stopping hook exactly once, for the nested session's own id
        // — the parent session must never observe a stopping callback.
        const result = yield* prompt.loop({ sessionID: chat.id }).pipe(
          Effect.timeoutOrElse({ duration: "20 seconds", orElse: () => Effect.die("loop did not terminate") }),
        )
        expect(result.info.role).toBe("assistant")
        const seen = yield* Effect.promise(async () => Bun.file(marker).text().catch(() => ""))
        expect(seen).toBe(chat.id)
        expect(seen).not.toBe(parent.id)
        const msgs = yield* sessions.messages({ sessionID: chat.id })
        expect(msgs.filter((m) => m.info.role === "assistant")).toHaveLength(1)
      }),
    {
      git: true,
      init: (dir) =>
        Effect.gen(function* () {
          const llm = yield* TestLLMServer
          const marker = path.join(dir, "stopping-fired")
          yield* writeText(path.join(dir, "plugin.ts"), `export default async () => ({ "session.stopping": async (input) => { await Bun.write(${JSON.stringify(marker)}, input.sessionID) },})`)
          yield* writeText(path.join(dir, "opencode.json"), JSON.stringify({ $schema: "https://opencode.ai/config.json", ...providerCfg(llm.url), plugin: [pathToFileURL(path.join(dir, "plugin.ts")).href] }))
        }),
    },
  )
})