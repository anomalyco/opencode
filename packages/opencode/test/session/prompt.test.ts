import { ConfigV1 } from "@opencode-ai/core/v1/config/config"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { Database } from "@opencode-ai/core/database/database"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { eq } from "drizzle-orm"
import { EventV2Bridge } from "@/event-v2-bridge"
import { expect } from "bun:test"
import { Cause, Deferred, Duration, Effect, Exit, Fiber, Layer, Stream } from "effect"
import { LLMEvent } from "@opencode-ai/llm"
import path from "path"
import { fileURLToPath } from "url"
import { NamedError } from "@opencode-ai/core/util/error"
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
import { SessionMessageTable } from "@opencode-ai/core/session/sql"
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
import { SessionV2 } from "@opencode-ai/core/session"
import { SessionExecution } from "@opencode-ai/core/session/execution"
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
import { awaitWithTimeout, pollWithTimeout, testEffect } from "../lib/effect"
import { raw, reply, TestLLMServer } from "../lib/llm-server"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ModelV2 } from "@opencode-ai/core/model"
import { LocationServiceMap, locationServiceMapLayer } from "@opencode-ai/core/location-services"

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

function withSh<A, E, R>(fx: () => Effect.Effect<A, E, R>) {
  return Effect.acquireUseRelease(
    Effect.sync(() => {
      const prev = process.env.SHELL
      process.env.SHELL = "/bin/sh"
      Shell.preferred.reset()
      return prev
    }),
    () => fx(),
    (prev) =>
      Effect.sync(() => {
        if (prev === undefined) delete process.env.SHELL
        else process.env.SHELL = prev
        Shell.preferred.reset()
      }),
  )
}

function toolPart(parts: SessionV1.Part[]) {
  return parts.find((part): part is SessionV1.ToolPart => part.type === "tool")
}

type CompletedToolPart = SessionV1.ToolPart & { state: SessionV1.ToolStateCompleted }
type ErrorToolPart = SessionV1.ToolPart & { state: SessionV1.ToolStateError }

function completedTool(parts: SessionV1.Part[]) {
  const part = toolPart(parts)
  expect(part?.state.status).toBe("completed")
  return part?.state.status === "completed" ? (part as CompletedToolPart) : undefined
}

function errorTool(parts: SessionV1.Part[]) {
  const part = toolPart(parts)
  expect(part?.state.status).toBe("error")
  return part?.state.status === "error" ? (part as ErrorToolPart) : undefined
}

function makeMcp(instructions: MCP.ServerInstructions[] = []) {
  return Layer.succeed(
    MCP.Service,
    MCP.Service.of({
      status: () => Effect.succeed({}),
      clients: () => Effect.succeed({}),
      instructions: () => Effect.succeed(instructions),
      tools: () => Effect.succeed({}),
      prompts: () => Effect.succeed({}),
      resources: () => Effect.succeed({}),
      resourceTemplates: () => Effect.succeed({}),
      add: () => Effect.succeed({ status: { status: "disabled" as const } }),
      connect: () => Effect.void,
      disconnect: () => Effect.void,
      getPrompt: () => Effect.succeed(undefined),
      readResource: () => Effect.succeed(undefined),
      startAuth: () => Effect.die("unexpected MCP auth in prompt-effect tests"),
      authenticate: () => Effect.die("unexpected MCP auth in prompt-effect tests"),
      finishAuth: () => Effect.die("unexpected MCP auth in prompt-effect tests"),
      removeAuth: () => Effect.void,
      supportsOAuth: () => Effect.succeed(false),
      hasStoredTokens: () => Effect.succeed(false),
      getAuthStatus: () => Effect.succeed("not_authenticated" as const),
    }),
  )
}

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

const processorCreateStarted: Array<() => void> = []
const blockingProcessor = Layer.succeed(
  SessionProcessor.Service,
  SessionProcessor.Service.of({
    create: () => Effect.sync(() => processorCreateStarted.shift()?.()).pipe(Effect.andThen(Effect.never)),
  }),
)

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

function makePrompt(input?: { mcpInstructions?: MCP.ServerInstructions[]; processor?: "blocking" }) {
  const replacements = [
    [SessionSummary.node, summary],
    [LSP.node, lsp],
    [MCP.node, makeMcp(input?.mcpInstructions)],
    [RuntimeFlags.node, runtimeFlags],
  ] as const
  if (input?.processor === "blocking") {
    return LayerNode.compile(promptRoot, [...replacements, [SessionProcessor.node, blockingProcessor]])
  }
  return LayerNode.compile(promptRoot, replacements)
}

function makeHttp(input?: { mcpInstructions?: MCP.ServerInstructions[]; processor?: "blocking" }) {
  const root = LayerNode.group([promptRoot, testLLMServerNode])
  const replacements = [
    [SessionSummary.node, summary],
    [LSP.node, lsp],
    [MCP.node, makeMcp(input?.mcpInstructions)],
    [RuntimeFlags.node, runtimeFlags],
  ] as const
  if (input?.processor === "blocking") {
    return LayerNode.compile(root, [...replacements, [SessionProcessor.node, blockingProcessor]])
  }
  return LayerNode.compile(root, replacements)
}

function makeHttpNoLLMServer(input?: { mcpInstructions?: MCP.ServerInstructions[]; processor?: "blocking" }) {
  return makePrompt(input)
}

const it = testEffect(makeHttp())
const noLLMServer = testEffect(makeHttpNoLLMServer())
const raceNoLLMServer = testEffect(makeHttpNoLLMServer({ processor: "blocking" }))
const withMcpInstructions = testEffect(
  makeHttp({
    mcpInstructions: [
      {
        name: "guide-server",
        instructions: "Use lookup before mutate.",
        tools: ["guide-server_lookup"],
      },
    ],
  }),
)
const unix = process.platform !== "win32" ? it.instance : it.instance.skip
const unixNoLLMServer = process.platform !== "win32" ? noLLMServer.instance : noLLMServer.instance.skip

// Config that registers a custom "test" provider with a "test-model" model
// so provider model lookup succeeds inside the loop.
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

const writeText = Effect.fn("test.writeText")(function* (file: string, text: string) {
  const fs = yield* FSUtil.Service
  yield* fs.writeWithDirs(file, text)
})

const writeConfig = Effect.fn("test.writeConfig")(function* (dir: string, config: Partial<ConfigV1.Info>) {
  yield* writeText(
    path.join(dir, "opencode.json"),
    JSON.stringify({ $schema: "https://opencode.ai/config.json", ...config }),
  )
})

const useServerConfig = Effect.fn("test.useServerConfig")(function* (config: (url: string) => Partial<ConfigV1.Info>) {
  const { directory: dir } = yield* TestInstance
  const llm = yield* TestLLMServer
  yield* writeConfig(dir, config(llm.url))
  return { dir, llm }
})

// Wait for a session's runner to enter a busy state. SessionStatus is flipped
// inside Runner.startShell's serialized transition, so cancel can't no-op once
// we observe it.
const waitForBusy = (sessionID: SessionID, duration: Duration.Input = "2 seconds") =>
  pollWithTimeout(
    Effect.gen(function* () {
      const status = yield* SessionStatus.Service
      const s = yield* status.get(sessionID)
      return s.type === "busy" ? (true as const) : undefined
    }),
    `session ${sessionID} never became busy`,
    duration,
  )

const hasBash = Effect.sync(() => Bun.which("bash") !== null)

const deferredAsPromise = <A>(deferred: Deferred.Deferred<A>): PromiseLike<A> => ({
  then: (onfulfilled, onrejected) => {
    Effect.runFork(
      Deferred.await(deferred).pipe(
        Effect.match({
          onFailure: (error) => {
            onrejected?.(error)
          },
          onSuccess: (value) => {
            onfulfilled?.(value)
          },
        }),
      ),
    )
    return deferredAsPromise(deferred) as PromiseLike<never>
  },
})

function defer<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

const succeedVoid = (deferred: Deferred.Deferred<void>) => {
  Effect.runSync(Deferred.succeed(deferred, void 0).pipe(Effect.ignore))
}

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

const addSubtask = (sessionID: SessionID, messageID: MessageID, model = ref) =>
  Effect.gen(function* () {
    const session = yield* Session.Service
    yield* session.updatePart({
      id: PartID.ascending(),
      messageID,
      sessionID,
      type: "subtask",
      prompt: "look into the cache key path",
      description: "inspect bug",
      agent: "general",
      model,
    })
  })

const boot = Effect.fn("test.boot")(function* (input?: { title?: string }) {
  const config = yield* Config.Service
  const prompt = yield* SessionPrompt.Service
  const run = yield* SessionRunState.Service
  const sessions = yield* Session.Service
  yield* config.get()
  const chat = yield* sessions.create(input ?? { title: "Pinned" })
  return { prompt, run, sessions, chat }
})

const g6PromptCases = [
  { name: "captured stop control", capture: true, finish: "stop" },
  { name: "captured raw other control", capture: true, finish: "other" },
  { name: "captured content filter", capture: true, finish: "content_filter" },
  { name: "captured length", capture: true, finish: "length" },
  { name: "captured ordinary fatal", capture: true, finish: "fatal" },
  { name: "captured canonical incomplete", capture: true, finish: "eof" },
  { name: "uncaptured length", capture: false, finish: "length" },
  { name: "uncaptured stop control", capture: false, finish: "stop" },
  { name: "uncaptured content filter control", capture: false, finish: "content_filter" },
  { name: "failed driver cancels and drains actual runner", capture: true, finish: "stop", driver: "primary" },
  { name: "driver and drain failures remain observable", capture: true, finish: "stop", driver: "combined" },
  { name: "settled tool failed driver control", capture: true, finish: "stop", driver: "primary", delayed: true },
  { name: "settled tool combined failure control", capture: true, finish: "stop", driver: "combined", delayed: true },
] as const

for (const fixture of g6PromptCases) {
  it.instance(`session.prompt G6 ${fixture.name}`, () =>
    Effect.gen(function* () {
      const { llm } = yield* useServerConfig((url) => ({ ...providerCfg(url), compaction: { auto: false } }))
      const prompt = yield* SessionPrompt.Service
      const sessions = yield* Session.Service
      const events = yield* EventV2Bridge.Service
      const chat = yield* sessions.create({
        title: "G6 pinned",
        permission: [{ permission: "*", pattern: "*", action: "allow" }],
      })
      const gate = defer<void>()
      const completed = yield* Deferred.make<{ messageID: MessageID; partID: PartID }>()
      const progressed = yield* Deferred.make<void>()
      let capturedMessageID: MessageID | undefined
      const errors: NonNullable<SessionV1.Assistant["error"]>[] = []
      const retries: number[] = []
      const off = yield* events.listen((event) => {
        if (event.type === Session.Event.Error.type) {
          const data = event.data as typeof Session.Event.Error.data.Type
          if (data.sessionID === chat.id && data.error) errors.push(data.error)
        }
        if (event.type === SessionStatus.Event.Status.type) {
          const data = event.data as typeof SessionStatus.Event.Status.data.Type
          if (data.sessionID === chat.id && data.status.type === "retry") retries.push(data.status.attempt)
        }
        if (event.type === MessageV2.Event.PartUpdated.type) {
          const data = event.data as typeof MessageV2.Event.PartUpdated.data.Type
          const part = data.part
          if (
            part.sessionID === chat.id &&
            part.type === "tool" &&
            part.tool === "StructuredOutput" &&
            part.state.status === "completed"
          ) {
            capturedMessageID = part.messageID
            return Deferred.succeed(completed, { messageID: part.messageID, partID: part.id }).pipe(Effect.asVoid)
          }
        }
        if (event.type === MessageV2.Event.PartDelta.type) {
          const data = event.data as typeof MessageV2.Event.PartDelta.data.Type
          if (
            data.sessionID === chat.id &&
            data.messageID === capturedMessageID &&
            data.field === "text" &&
            data.delta === "G6 after capture"
          )
            return Deferred.succeed(progressed, undefined).pipe(Effect.asVoid)
        }
        return Effect.void
      })
      yield* Effect.addFinalizer(() => Effect.sync(() => gate.resolve()).pipe(Effect.andThen(off)))
      const answer = { answer: "G6 captured" }
      const driver = "driver" in fixture ? fixture.driver : undefined
      const delayed = "delayed" in fixture
      const fatal = { message: "G6 fatal sentinel", type: "invalid_request_error", code: "g6_fatal" }
      yield* prompt.prompt({
        sessionID: chat.id,
        agent: "build",
        noReply: true,
        format: new SessionV1.OutputFormatJsonSchema({
          type: "json_schema",
          schema: {
            type: "object",
            properties: { answer: { type: "string" } },
            required: ["answer"],
            additionalProperties: false,
          },
          retryCount: 0,
        }),
        parts: [{ type: "text", text: "Return the structured answer" }],
      })
      yield* llm.push(
        raw({
          head: [
            { choices: [{ delta: { role: "assistant", content: "G6 partial" } }] },
            ...(fixture.capture
              ? [
                  {
                    choices: [
                      {
                        delta: {
                          tool_calls: [
                            {
                              index: 0,
                              id: "g6-structured",
                              type: "function",
                              function: { name: "StructuredOutput", arguments: JSON.stringify(answer) },
                            },
                          ],
                        },
                      },
                    ],
                  },
                ]
              : []),
          ],
          // compatible 2.0.41 emits a complete JSON call before finish; the real
          // validated tool must complete before we release this terminal tail.
          wait: fixture.capture ? gate.promise : undefined,
          hang: !!driver,
          tail: driver
            ? delayed
              ? [{ choices: [{ delta: { content: "G6 after capture" } }] }]
              : []
            : fixture.finish === "fatal"
              ? [{ error: fatal }]
              : fixture.finish === "eof"
                ? []
                : [{ choices: [{ delta: {}, finish_reason: fixture.finish }] }],
        }),
      )
      const run = yield* prompt.loop({ sessionID: chat.id }).pipe(Effect.forkChild)
      const primary = new Error("G6 forced driver failure")
      const secondary = new Error("G6 forced drain failure")
      let before: { part: SessionV1.ToolPart; stored: SessionV1.WithParts } | undefined
      let drained: Exit.Exit<SessionV1.WithParts, unknown> | undefined
      let cancellations = 0
      const driven = yield* Effect.gen(function* () {
        if (fixture.capture) {
          const ready = yield* awaitWithTimeout(
            Effect.raceFirst(
              Deferred.await(completed).pipe(Effect.map((ids) => ({ type: "tool" as const, ids }))),
              Fiber.await(run).pipe(Effect.map(() => ({ type: "completed" as const }))),
            ),
            "G6 structured tool never completed before the terminal tail",
            "10 seconds",
          )
          if (ready.type !== "tool") throw new Error("G6 prompt completed before tool capture")
          const stored = yield* MessageV2.get({ sessionID: chat.id, messageID: ready.ids.messageID })
          const part = stored.parts.find((part) => part.id === ready.ids.partID)
          if (part?.type !== "tool" || part.state.status !== "completed")
            throw new Error("G6 completion event had no durable completed tool")
          before = { part: structuredClone(part), stored }
        }
        if (delayed) {
          gate.resolve()
          const next = yield* awaitWithTimeout(
            Effect.raceFirst(
              Deferred.await(progressed).pipe(Effect.as("progress" as const)),
              Fiber.await(run).pipe(Effect.as("completed" as const)),
            ),
            "G6 consumer did not advance beyond tool-result",
            "10 seconds",
          )
          if (next !== "progress") throw new Error("G6 prompt completed before later text delta")
        }
        if (driver) return yield* Effect.fail(primary)
        gate.resolve()
        return yield* awaitWithTimeout(Fiber.await(run), "G6 prompt did not finish", "10 seconds")
      }).pipe(
        Effect.onExit((exit) =>
          Exit.isSuccess(exit)
            ? Effect.void
            : Effect.gen(function* () {
                // prompt.loop is only a waiter. Cancel the actual instance-scoped
                // runner, release the wire gate, and observe both completions.
                gate.resolve()
                yield* awaitWithTimeout(
                  Effect.gen(function* () {
                    yield* prompt.cancel(chat.id)
                    cancellations++
                    drained = yield* Fiber.await(run)
                  }),
                  "G6 actual runner cancellation/drain did not finish",
                  "5 seconds",
                )
                // Inject only after real cancellation/drain, not a production fault.
                if (driver === "combined") return yield* Effect.fail(secondary)
              }).pipe(
                Effect.ensuring(Effect.sync(() => gate.resolve())),
                Effect.exit,
                Effect.flatMap((cleanup) =>
                  Exit.isFailure(cleanup) ? Effect.failCause(Cause.combine(exit.cause, cleanup.cause)) : Effect.void,
                ),
              ),
        ),
        Effect.exit,
      )
      if (driver) {
        expect(Exit.isFailure(driven)).toBe(true)
        if (!Exit.isFailure(driven)) throw new Error("G6 driver unexpectedly succeeded")
        const failures = driven.cause.reasons.filter(Cause.isFailReason).map((reason) => reason.error)
        expect(failures).toHaveLength(driver === "combined" ? 2 : 1)
        expect(failures[0]).toBe(primary)
        if (driver === "combined") expect(failures[1]).toBe(secondary)
        expect(cancellations).toBe(1)
        expect(drained).toBeDefined()
      } else {
        expect(Exit.isSuccess(driven)).toBe(true)
        if (!Exit.isSuccess(driven)) return yield* Effect.failCause(driven.cause)
      }
      const exit = Exit.isSuccess(driven) ? driven.value : drained
      if (!exit) throw new Error("G6 missing drained prompt Exit")
      expect(Exit.isSuccess(exit)).toBe(true)
      if (!Exit.isSuccess(exit)) throw new Error("G6 unexpected prompt failure Exit")
      const result = exit.value
      const stored = yield* MessageV2.get({ sessionID: chat.id, messageID: result.info.id })
      if (result.info.role !== "assistant" || stored.info.role !== "assistant") throw new Error("G6 expected assistant")
      const messages = yield* sessions.messages({ sessionID: chat.id })
      const steps = stored.parts.filter((part) => part.type === "step-finish").map((part) => part.reason)
      console.log(
        "G6 prompt observation",
        JSON.stringify({
          name: fixture.name,
          capturedBeforeTail: before !== undefined,
          calls: yield* llm.calls,
          retries,
          finish: stored.info.finish,
          error: stored.info.error ?? null,
          structured: stored.info.structured ?? null,
          steps,
          errors,
        }),
      )
      expect(yield* llm.calls).toBe(1)
      expect(yield* llm.pending).toBe(0)
      expect(retries).toEqual([])
      expect(messages.filter((message) => message.info.role === "assistant")).toHaveLength(1)
      expect(messages.some((message) => message.parts.some((part) => part.type === "compaction"))).toBe(false)
      expect(stored.info).toEqual(result.info)
      expect(stored.info.time.completed).toEqual(expect.any(Number))
      expect(
        stored.parts
          .filter((part) => part.type === "text")
          .map((part) => part.text)
          .join(""),
      ).toBe(delayed ? "G6 partialG6 after capture" : "G6 partial")
      if (fixture.capture) {
        expect(before).toBeDefined()
        if (!before) throw new Error("G6 tool capture prerequisite did not execute")
        expect(before.part.state).toMatchObject({
          status: "completed",
          input: answer,
          output: "Structured output captured successfully.",
          title: "Structured Output",
          metadata: { valid: true },
        })
        expect(before.stored.parts).toContainEqual(before.part)
        expect(before.stored.parts.some((part) => part.type === "step-finish")).toBe(false)
      }
      if (driver) {
        const status = yield* SessionStatus.Service
        expect(yield* status.get(chat.id)).toEqual({ type: "idle" })
        expect(steps).toEqual([])
        expect(stored.info.finish).toBeUndefined()
        expect(stored.info.error).toEqual({ name: "MessageAbortedError", data: { message: "Aborted" } })
        expect(errors).toEqual([stored.info.error!])
        expect(stored.info.structured).toBeUndefined()
        if (!before) throw new Error("G6 missing captured tool snapshot")
        expect(stored.parts).toContainEqual(before.part)
        return
      }
      if (before) expect(stored.parts).toContainEqual(before.part)
      const finish =
        fixture.finish === "fatal"
          ? undefined
          : fixture.finish === "content_filter"
            ? "content-filter"
            : ["other", "eof"].includes(fixture.finish)
              ? "unknown"
              : fixture.finish
      if (fixture.finish !== "fatal")
        expect(steps).toEqual([
          fixture.finish === "content_filter"
            ? "content-filter"
            : ["other", "eof"].includes(fixture.finish)
              ? "unknown"
              : fixture.finish,
        ])
      const accepted = fixture.capture && (fixture.finish === "stop" || fixture.finish === "other")
      const expected: SessionV1.Assistant["error"] =
        fixture.finish === "length"
          ? { name: "MessageOutputLengthError", data: {} }
          : fixture.finish === "content_filter"
            ? {
                name: "ContentFilterError",
                data: { message: "The response was blocked by the provider's content filter" },
              }
            : fixture.finish === "fatal"
              ? { name: "UnknownError", data: { message: JSON.stringify(fatal) } }
              : !fixture.capture
                ? {
                    name: "StructuredOutputError",
                    data: { message: "Model did not produce structured output", retries: 0 },
                  }
                : undefined
      // The canonical EOF case is recognition-blocked until the real adapter
      // produces the marker; it is not independent proof of caller precedence.
      // An incomplete stream settles as a terminal: finish "error" carries the
      // recognition message while the durable step-finish part keeps its own
      // "unknown" reason. The message is asserted before any asymmetric matcher,
      // whose write-back would otherwise replace the received string.
      if (fixture.finish === "eof") {
        if (stored.info.error?.name !== "UnknownError") throw new Error("G6 canonical marker not recognized")
        expect(typeof stored.info.error.data.message).toBe("string")
        expect(stored.info.error.data.message.trim().length).toBeGreaterThan(0)
        expect(errors).toEqual([stored.info.error])
        expect(stored.info.finish).toBe("error")
        expect(stored.info.structured).toBeUndefined()
      } else {
        expect({
          finish: stored.info.finish,
          error: stored.info.error,
          structured: stored.info.structured,
          errors,
        }).toEqual({
          finish,
          error: expected,
          structured: accepted ? answer : undefined,
          errors: expected && expected.name !== "StructuredOutputError" ? [expected] : [],
        })
      }
    }),
  )
}

// G7 reactive recovery uses the real Legacy prompt/compaction/processor graph.
// This observer retains the original node dependencies; its inner layer is the
// actual processor, not a second compiled graph or a mocked recovery service.
const g7Creates = new Map<SessionID, SessionProcessor.Handle[]>()
const g7Histories = new Map<SessionID, Array<{ messageID: MessageID; messages: SessionV1.WithParts[] }>>()
const g7Processor = {
  ...SessionProcessor.node,
  implementation: Layer.effect(
    SessionProcessor.Service,
    Effect.gen(function* () {
      const real = yield* SessionProcessor.Service
      const database = yield* Database.Service
      return SessionProcessor.Service.of({
        create: (input) =>
          Effect.gen(function* () {
            const handle = yield* real.create(input)
            // Observe execution, not construction of the create Effect.
            g7Creates.get(input.sessionID)?.push(handle)
            const histories = g7Histories.get(input.sessionID)
            if (histories)
              histories.push({
                messageID: handle.message.id,
                messages: structuredClone(
                  yield* MessageV2.filterCompactedEffect(input.sessionID).pipe(
                    Effect.provideService(Database.Service, database),
                  ),
                ),
              })
            return handle
          }),
      })
    }),
  ).pipe(Layer.provide([SessionProcessor.node.implementation!])),
}
const g7Prompt = testEffect(
  LayerNode.compile(promptRoot, [
    [SessionSummary.node, summary], // Diff summary only; compaction still calls the real LLM.
    [LSP.node, lsp],
    [MCP.node, makeMcp()],
    [RuntimeFlags.node, runtimeFlags],
    [SessionProcessor.node, g7Processor],
  ]),
)

const g7PromptCases = [
  { name: "R25 one episode spans summary and fresh post-main handle", mode: "episode", history: true, auto: true },
  { name: "R25 retained old user isolates episode allowance", mode: "retained-episode", history: true, auto: true },
  { name: "recovery success control", mode: "success", history: true, auto: true },
  { name: "R26 auto false stops early overflow", mode: "auto-false", history: true, auto: false },
  { name: "R26 current-only has no old history to compact", mode: "current-only", history: false, auto: true },
  { name: "R27 summary overflow stops without post-main", mode: "summary-overflow", history: true, auto: true },
  { name: "R27 summary fatal 401 stops without post-main", mode: "summary-fatal", history: true, auto: true },
  { name: "failed driver cancels and drains active summary", mode: "driver-primary", history: true, auto: true },
  {
    name: "active summary driver and drain failures remain observable",
    mode: "driver-combined",
    history: true,
    auto: true,
  },
] as const

for (const fixture of g7PromptCases) {
  g7Prompt.instance(
    `session.prompt G7 ${fixture.name}`,
    () =>
      Effect.gen(function* () {
        const oldUserText = "G7_U0_OLD_USER"
        const oldAssistantText = "G7_A0_COMPLETED_ANSWER"
        const retained = fixture.mode === "retained-episode"
        const retainedUserText = "G7_U1_RETAINED_OLD_USER"
        const retainedAssistantText = "G7_A1_RETAINED_COMPLETED_ANSWER"
        const currentText = retained ? "G7_U2_CURRENT_REQUEST" : "G7_U1_CURRENT_REQUEST"
        const summaryText = "G7_REAL_COMPACTION_SUMMARY"
        const answerText = "G7_POST_MAIN_ANSWER"
        const overflowBody = { error: { code: "context_length_exceeded", message: "g7 opaque detail" } }
        const fatalBody = { error: { code: "g7_fatal", message: "G7 nonretryable fatal sentinel" } }
        const overflowError: NonNullable<SessionV1.Assistant["error"]> = {
          name: "ContextOverflowError",
          data: { message: "g7 opaque detail", responseBody: JSON.stringify(overflowBody) },
        }
        const driver =
          fixture.mode === "driver-primary" ? "primary" : fixture.mode === "driver-combined" ? "combined" : undefined
        const summaryActive = yield* Deferred.make<void>()
        const planned = [
          { role: "main", response: "overflow" },
          {
            role: "summary",
            response: driver
              ? "summary-hang"
              : fixture.mode === "summary-overflow"
                ? "overflow"
                : fixture.mode === "summary-fatal"
                  ? "fatal"
                  : "summary-stop",
          },
          { role: "post-main", response: fixture.mode === "episode" || retained ? "overflow" : "main-stop" },
          { role: "unexpected-summary", response: "fatal" },
        ]
        const calls: Array<{ ordinal: number; role: string; response: string; body: Record<string, unknown> }> = []
        // Unlike TestLLMServer's default success response, EVERY overrun here is
        // a nonretryable 401. Unconsumed planned responses are not failed tests:
        // the desired early-stop implementations must leave those plans unused.
        const server = yield* Effect.acquireRelease(
          Effect.sync(() =>
            Bun.serve({
              hostname: "127.0.0.1",
              port: 0,
              async fetch(request) {
                const ordinal = calls.length
                const plan = planned[ordinal] ?? { role: "unexpected-default", response: "fatal" }
                const call = { ordinal: ordinal + 1, ...plan, body: {} as Record<string, unknown> }
                calls.push(call) // Count even malformed/unexpected invocations before reading JSON.
                call.body = await request.json().catch(() => ({}))
                if (plan.response === "overflow" || plan.response === "fatal")
                  return Response.json(plan.response === "overflow" ? overflowBody : fatalBody, {
                    status: plan.response === "overflow" ? 400 : 401,
                  })
                if (plan.response === "summary-hang") {
                  const body = new ReadableStream<Uint8Array>({
                    start(controller) {
                      // An actual HTTP request is active, with no finish, DONE,
                      // provider failure, or output text that could settle it.
                      controller.enqueue(
                        new TextEncoder().encode('data: {"choices":[{"delta":{"role":"assistant"}}]}\n\n'),
                      )
                    },
                  })
                  succeedVoid(summaryActive)
                  return new Response(body, { headers: { "content-type": "text/event-stream" } })
                }
                const text = plan.response === "summary-stop" ? summaryText : answerText
                const chunks = [
                  { choices: [{ delta: { role: "assistant", content: text } }] },
                  {
                    choices: [{ delta: {}, finish_reason: "stop" }],
                    usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
                  },
                ]
                return new Response(
                  chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("") + "data: [DONE]\n\n",
                  {
                    headers: { "content-type": "text/event-stream" },
                  },
                )
              },
            }),
          ),
          (server) => Effect.promise(() => server.stop(true)),
        )
        const { directory } = yield* TestInstance
        const base = providerCfg(`http://127.0.0.1:${server.port}/v1`)
        const { id: _id, ...model } = base.provider.test.models["test-model"]
        yield* writeConfig(directory, {
          ...base,
          provider: {
            ...base.provider,
            test: {
              ...base.provider.test,
              // No id aliases: body.model independently identifies each phase.
              models: { "test-model": model, "g7-summary": { ...model, name: "G7 Summary" } },
            },
          },
          agent: { compaction: { model: "test/g7-summary" } },
          compaction: {
            auto: fixture.auto,
            prune: false,
            tail_turns: retained ? 1 : 0,
            ...(retained ? { preserve_recent_tokens: 10000 } : {}),
          },
        })
        const sessions = yield* Session.Service
        const prompt = yield* SessionPrompt.Service
        const events = yield* EventV2Bridge.Service
        const chat = yield* sessions.create({ title: "G7 pinned nondefault title" })
        const handles: SessionProcessor.Handle[] = []
        g7Creates.set(chat.id, handles)
        yield* Effect.addFinalizer(() => Effect.sync(() => g7Creates.delete(chat.id)))
        const histories: Array<{ messageID: MessageID; messages: SessionV1.WithParts[] }> = []
        if (retained) {
          g7Histories.set(chat.id, histories)
          yield* Effect.addFinalizer(() => Effect.sync(() => g7Histories.delete(chat.id)))
        }
        let retainedUserID: MessageID | undefined
        if (fixture.history) {
          const oldUser = yield* user(chat.id, oldUserText)
          const oldAssistant: SessionV1.Assistant = {
            id: MessageID.ascending(),
            role: "assistant",
            parentID: oldUser.id,
            sessionID: chat.id,
            agent: "build",
            mode: "build",
            modelID: ref.modelID,
            providerID: ref.providerID,
            path: { cwd: directory, root: directory },
            cost: 0,
            tokens: { input: 3, output: 2, reasoning: 0, cache: { read: 0, write: 0 } },
            finish: "stop",
            time: { created: Date.now(), completed: Date.now() },
          }
          yield* sessions.updateMessage(oldAssistant)
          yield* sessions.updatePart({
            id: PartID.ascending(),
            messageID: oldAssistant.id,
            sessionID: chat.id,
            type: "text",
            text: oldAssistantText,
            time: { start: Date.now(), end: Date.now() },
          })
          if (retained) {
            const retainedUser = yield* user(chat.id, retainedUserText)
            retainedUserID = retainedUser.id
            const retainedAssistant = yield* sessions.updateMessage({
              ...oldAssistant,
              id: MessageID.ascending(),
              parentID: retainedUser.id,
              time: { created: Date.now(), completed: Date.now() },
            })
            yield* sessions.updatePart({
              id: PartID.ascending(),
              messageID: retainedAssistant.id,
              sessionID: chat.id,
              type: "text",
              text: retainedAssistantText,
              time: { start: Date.now(), end: Date.now() },
            })
          }
        }
        const current = yield* user(chat.id, currentText) // Explicit main ref survives replay.
        const before = structuredClone(yield* sessions.messages({ sessionID: chat.id }))
        const errors: NonNullable<SessionV1.Assistant["error"]>[] = []
        const retries: number[] = []
        let compacted = 0
        const off = yield* events.listen((event) => {
          if (event.type === Session.Event.Error.type) {
            const data = event.data as typeof Session.Event.Error.data.Type
            if (data.sessionID === chat.id && data.error) errors.push(data.error)
          }
          if (event.type === SessionStatus.Event.Status.type) {
            const data = event.data as typeof SessionStatus.Event.Status.data.Type
            if (data.sessionID === chat.id && data.status.type === "retry") retries.push(data.status.attempt)
          }
          if (event.type === SessionCompaction.Event.Compacted.type) {
            const data = event.data as typeof SessionCompaction.Event.Compacted.data.Type
            if (data.sessionID === chat.id) compacted++
          }
          return Effect.void
        })
        yield* Effect.addFinalizer(() => off)
        const run = yield* prompt.loop({ sessionID: chat.id }).pipe(Effect.forkChild)
        const primary = new Error("G7 forced driver failure")
        const secondary = new Error("G7 forced drain failure")
        let drained: Exit.Exit<SessionV1.WithParts, unknown> | undefined
        let cancellations = 0
        let ready: "summary" | "completed" | undefined
        const driven = yield* Effect.gen(function* () {
          if (driver) {
            ready = yield* awaitWithTimeout(
              Effect.raceFirst(
                Deferred.await(summaryActive).pipe(Effect.as("summary" as const)),
                Fiber.await(run).pipe(Effect.as("completed" as const)),
              ),
              "G7 summary HTTP request never became active",
              "10 seconds",
            )
            if (ready !== "summary") throw new Error("G7 runner completed before summary HTTP arrival")
            return yield* Effect.fail(primary)
          }
          return yield* awaitWithTimeout(Fiber.await(run), "G7 prompt did not finish", "10 seconds")
        }).pipe(
          Effect.onExit((exit) =>
            Exit.isSuccess(exit)
              ? Effect.void
              : awaitWithTimeout(
                  Effect.gen(function* () {
                    // loop is a waiter, not the actual runner. Cancel the latter
                    // and observe the waiter; success here is NOT interrupt Exit.
                    yield* prompt.cancel(chat.id)
                    cancellations++
                    drained = yield* Fiber.await(run)
                    // A test driver fault, injected only AFTER the real drain.
                    if (driver === "combined") return yield* Effect.fail(secondary)
                  }),
                  "G7 actual runner cancellation/drain did not finish",
                  "5 seconds",
                ).pipe(
                  Effect.exit,
                  Effect.flatMap((cleanup) =>
                    Exit.isFailure(cleanup) ? Effect.failCause(Cause.combine(exit.cause, cleanup.cause)) : Effect.void,
                  ),
                ),
          ),
          Effect.exit,
        )
        if (!driver && Exit.isFailure(driven)) return yield* Effect.failCause(driven.cause)
        const exit = Exit.isSuccess(driven) ? driven.value : drained
        if (!exit) throw new Error("G7 missing drained prompt Exit")
        if (!Exit.isSuccess(exit)) return yield* Effect.failCause(exit.cause)
        const result = exit.value
        const stored = yield* MessageV2.get({ sessionID: chat.id, messageID: result.info.id })
        const messages = yield* sessions.messages({ sessionID: chat.id })
        const created = messages.filter((message) => !before.some((old) => old.info.id === message.info.id))
        const assistants = created.filter((message) => message.info.role === "assistant")
        const summaries = assistants.filter((message) => message.info.role === "assistant" && message.info.summary)
        const compactions = created.flatMap((message) => message.parts.filter((part) => part.type === "compaction"))
        const replayed = created.filter(
          (message) =>
            message.info.role === "user" &&
            message.parts.some((part) => part.type === "text" && part.text === currentText),
        )
        const terminal = (message: SessionV1.WithParts) => {
          if (message.info.role !== "assistant") throw new Error("G7 expected assistant terminal")
          return {
            summary: message.info.summary === true,
            finish: message.info.finish,
            error: message.info.error,
            structured: message.info.structured,
            text: message.parts
              .filter((part) => part.type === "text")
              .map((part) => part.text)
              .join(""),
            steps: message.parts.filter((part) => part.type === "step-finish").map((part) => part.reason),
          }
        }
        console.log(
          "G7 prompt observation",
          JSON.stringify({
            name: fixture.name,
            planned,
            consumed: calls.map(({ ordinal, role, response, body }) => ({
              ordinal,
              role,
              response,
              model: body.model,
            })),
            pending: planned.slice(calls.length),
            requests: calls.length,
            driver: driver
              ? {
                  ready,
                  cancellations,
                  failures: Exit.isFailure(driven)
                    ? driven.cause.reasons.filter(Cause.isFailReason).map((reason) => String(reason.error))
                    : [],
                  drained: drained ? Exit.isSuccess(drained) : false,
                }
              : undefined,
            creates: handles.map((handle) => ({
              id: handle.message.id,
              parentID: handle.message.parentID,
              summary: handle.message.summary === true,
              model: handle.message.modelID,
            })),
            filteredHistoryAtCreate: retained ? histories : undefined,
            assistants: assistants.map((message) => ({ id: message.info.id, ...terminal(message) })),
            compactions,
            replayed,
            compacted,
            errors,
            retries,
            returned: terminal(result),
            durable: terminal(stored),
            // Keep the actual conversation payload, excluding the unrelated large
            // system prompt. Markers below are asserted against the full request.
            wireMessages: calls.map((call) =>
              Array.isArray(call.body.messages)
                ? call.body.messages.filter((message) => message.role !== "system")
                : call.body.messages,
            ),
          }),
        )
        // All assertions follow completion and the full finite timeline log.
        for (const old of before) expect(messages.find((message) => message.info.id === old.info.id)).toEqual(old)
        expect(retries).toEqual([])
        expect(new Set(handles).size).toBe(handles.length)
        expect(handles.map((handle) => handle.message.id)).toEqual(assistants.map((message) => message.info.id))
        expect(calls).toHaveLength(handles.length)
        expect(calls.map((call) => call.body.model)).toEqual(handles.map((handle) => handle.message.modelID))
        expect(handles[0].message.parentID).toBe(current.id)
        for (const message of assistants) {
          if (message.info.role !== "assistant") throw new Error("G7 expected created assistant")
          expect(message.info.time.completed).toEqual(expect.any(Number))
          if (message.info.summary) {
            const { parentID } = message.info
            const part = compactions.find((part) => part.messageID === parentID)
            expect(part).toBeDefined()
            if (!part) throw new Error("G7 summary missing its real compaction user")
            expect(part).toEqual({
              id: part.id,
              messageID: message.info.parentID,
              sessionID: chat.id,
              type: "compaction",
              auto: true,
              overflow: true,
              ...(retained ? { tail_start_id: part === compactions[0] ? retainedUserID : current.id } : {}),
            })
          }
        }
        if (calls[1]?.response === "summary-stop")
          expect(terminal(summaries[0])).toEqual({
            summary: true,
            finish: "stop",
            error: undefined,
            structured: undefined,
            text: summaryText,
            steps: ["stop"],
          })
        expect(stored).toEqual(result)
        expect(JSON.stringify(calls[0].body.messages)).toContain(currentText)
        if (fixture.history) {
          expect(JSON.stringify(calls[0].body.messages)).toContain(oldUserText)
          expect(JSON.stringify(calls[0].body.messages)).toContain(oldAssistantText)
          if (calls[1]) {
            const payload = JSON.stringify(calls[1].body.messages)
            expect(payload).toContain(oldUserText)
            expect(payload).toContain(oldAssistantText)
            expect(payload).not.toContain(currentText)
            if (retained) {
              expect(payload).not.toContain(retainedUserText)
              expect(payload).not.toContain(retainedAssistantText)
            }
          }
          for (const replay of replayed) {
            if (replay.info.role !== "user") throw new Error("G7 expected replayed user")
            const original = before.find((message) => message.info.id === current.id)
            expect(original).toBeDefined()
            if (!original || original.info.role !== "user") throw new Error("G7 expected original current user")
            expect(replay.info.model).toEqual(ref)
            const { id: replayID, time: replayTime, ...replayInfo } = replay.info
            const { id: originalID, time: originalTime, ...originalInfo } = original.info
            expect(replayID).not.toBe(originalID)
            expect(replayTime.created).toEqual(expect.any(Number))
            expect(replayInfo).toEqual(originalInfo)
            expect(replay.parts.map(({ id, messageID, ...payload }) => payload)).toEqual(
              original.parts.map(({ id, messageID, ...payload }) => payload),
            )
          }
          if (calls[2]) {
            const payload = JSON.stringify(calls[2].body.messages)
            expect(payload).toContain(summaryText)
            expect(payload).toContain(currentText)
            expect(payload).not.toContain(oldUserText)
            expect(replayed).toHaveLength(1)
            expect(handles[2].message.parentID).toBe(replayed[0].info.id)
            if (retained) {
              expect(payload).toContain(retainedUserText)
              expect(payload).toContain(retainedAssistantText)
              expect(compactions[0].tail_start_id).toBe(retainedUserID)
              const history = histories.find((entry) => entry.messageID === handles[2].message.id)?.messages
              expect(history).toBeDefined()
              if (!history) throw new Error("G7 missing filtered post-main admission history")
              const oldIndex = history.findIndex((message) => message.info.id === retainedUserID)
              const replayIndex = history.findIndex((message) => message.info.id === replayed[0].info.id)
              expect(oldIndex).toBeGreaterThanOrEqual(0)
              expect(replayIndex).toBeGreaterThan(oldIndex)
              const retainedUser = before.find((message) => message.info.id === retainedUserID)
              expect(retainedUser).toBeDefined()
              if (!retainedUser) throw new Error("G7 expected seeded retained user")
              expect(history[oldIndex]).toEqual(retainedUser)
              expect(history[oldIndex].info.role).toBe("user")
              expect(history[oldIndex].parts.some((part) => part.type === "compaction")).toBe(false)
              expect(MessageV2.latest(history).user?.id).toBe(replayed[0].info.id)
            }
          }
        }
        if (driver) {
          expect(Exit.isFailure(driven)).toBe(true)
          if (!Exit.isFailure(driven)) throw new Error("G7 driver unexpectedly succeeded")
          const failures = driven.cause.reasons.filter(Cause.isFailReason).map((reason) => reason.error)
          expect(failures).toHaveLength(driver === "combined" ? 2 : 1)
          expect(failures[0]).toBe(primary)
          if (driver === "combined") expect(failures[1]).toBe(secondary)
          expect(ready).toBe("summary")
          expect(cancellations).toBe(1)
          expect(drained && Exit.isSuccess(drained)).toBe(true)
          const abort: NonNullable<SessionV1.Assistant["error"]> = {
            name: "MessageAbortedError",
            data: { message: "Aborted" },
          }
          const expectedTerminal = {
            summary: true,
            finish: undefined,
            error: abort,
            structured: undefined,
            text: "",
            steps: [],
          }
          expect({
            requests: calls.length,
            consumed: calls.map(({ role, response }) => ({ role, response })),
            pending: planned.slice(calls.length),
            models: calls.map((call) => call.body.model),
            summaries: summaries.length,
            compactions: compactions.length,
            compacted,
            replayed: replayed.length,
            returned: terminal(result),
            durable: terminal(stored),
            errors,
          }).toEqual({
            requests: 2,
            consumed: [
              { role: "main", response: "overflow" },
              { role: "summary", response: "summary-hang" },
            ],
            pending: planned.slice(2),
            models: ["test-model", "g7-summary"],
            summaries: 1,
            compactions: 1,
            compacted: 0,
            replayed: 0,
            returned: expectedTerminal,
            durable: expectedTerminal,
            errors: [overflowError, abort],
          })
          const status = yield* SessionStatus.Service
          expect(yield* status.get(chat.id)).toEqual({ type: "idle" })
          return
        }
        // In tail_turns:0 R25, the first compaction filters U0; the second summary
        // uses no-replay fallback. That case alone cannot isolate episode budget
        // from an old-history veto. The retained-tail pair above proves U1 is
        // still an eligible ordinary old user at the fresh post-main admission.
        const early = fixture.mode === "auto-false" || fixture.mode === "current-only"
        const success = fixture.mode === "success"
        const summaryFailure = fixture.mode === "summary-overflow" || fixture.mode === "summary-fatal"
        const expectedCalls = early ? 1 : summaryFailure ? 2 : 3
        const fatalError: NonNullable<SessionV1.Assistant["error"]> = {
          name: "APIError",
          data: {
            message: "G7 nonretryable fatal sentinel",
            statusCode: 401,
            isRetryable: false,
            responseHeaders: expect.any(Object), // Transport-generated headers vary; full values logged above.
            responseBody: JSON.stringify(fatalBody),
            metadata: { url: `http://127.0.0.1:${server.port}/v1/chat/completions` },
          },
        }
        const expectedError: SessionV1.Assistant["error"] = success
          ? undefined
          : fixture.mode === "summary-overflow"
            ? {
                name: "ContextOverflowError",
                // compaction.ts:450-458 rewrites the durable summary error, but
                // the emitted event remains the original provider overflow.
                data: { message: "Conversation history too large to compact - exceeds model context limit" },
              }
            : fixture.mode === "summary-fatal"
              ? fatalError
              : overflowError
        const expectedTerminal = {
          summary: summaryFailure,
          finish: success ? "stop" : fixture.mode === "summary-fatal" ? undefined : "error",
          error: expectedError,
          structured: undefined,
          text: success ? answerText : "",
          steps: success ? ["stop"] : [],
        }
        expect({
          requests: calls.length,
          consumed: calls.map((call) => call.role),
          pending: planned.slice(calls.length).map((plan) => plan.role),
          models: calls.map((call) => call.body.model),
          summaries: summaries.length,
          compactions: compactions.length,
          compacted,
          replayed: replayed.length,
          returned: terminal(result),
          durable: terminal(stored),
          errors,
        }).toEqual({
          requests: expectedCalls,
          consumed: planned.slice(0, expectedCalls).map((plan) => plan.role),
          pending: planned.slice(expectedCalls).map((plan) => plan.role),
          models: ["test-model", "g7-summary", "test-model"].slice(0, expectedCalls),
          summaries: early ? 0 : 1,
          compactions: early ? 0 : 1,
          compacted: early || summaryFailure ? 0 : 1,
          replayed: early || summaryFailure ? 0 : 1,
          returned: expectedTerminal,
          durable: expectedTerminal,
          errors:
            early || success
              ? [overflowError]
              : [overflowError, fixture.mode === "summary-fatal" ? fatalError : overflowError],
        })
      }),
    20000,
  )
}
// G7 R28 proactive insertion and R29 subsequent same-run/new-run episodes are
// not simulated here. Summary length/incomplete and broader cancellation policy
// remain untested; the two summary cancellations above validate driver cleanup.

// G8 final-message persistence faults are injected before delegation ONLY into
// the Session writer captured by the real processor. Prompt's Session remains
// healthy. These normalized-source fixtures do not exercise HTTP/SDK or SQLite
// failures, and never substitute a test outer-finalizer failure for a store fault.
const g8PromptCases = [
  { name: "fatal healthy final write", ending: "fatal", fault: false, driver: false },
  { name: "fatal final write failure preserves primary Cause", ending: "fatal", fault: true, driver: false },
  { name: "cancel healthy final write", ending: "cancel", fault: false, driver: false },
  { name: "cancel final write failure preserves interrupt", ending: "cancel", fault: true, driver: false },
  { name: "failed driver observes actual runner persistence failure", ending: "cancel", fault: true, driver: true },
] as const

for (const fixture of g8PromptCases) {
  const primary = new Error("G8 prompt primary failure")
  const storage = new Error("G8 processor final-message persistence failure")
  const driverFailure = new Error("G8 forced prompt driver failure")
  const text = "G8 emitted partial text"
  const metadata = { g8: { retained: "complete text payload" } }
  const activity = [
    LLMEvent.stepStart({ index: 0 }),
    LLMEvent.textStart({ id: "g8-text", providerMetadata: metadata }),
    LLMEvent.textDelta({ id: "g8-text", text }),
  ]
  let targetSession: SessionID | undefined
  let targetMessage: MessageID | undefined
  let ready: Deferred.Deferred<void> | undefined
  let release: Deferred.Deferred<void> | undefined
  let inspect: Effect.Effect<SessionV1.WithParts> = Effect.die("G8 observer not initialized")
  let beforeCleanup: SessionV1.WithParts | undefined
  let memory: SessionV1.Assistant | undefined
  let invocations = 0
  let primaryEmissions = 0
  let faultHits = 0
  const emitted: LLMEvent[] = []
  const sourceExits: Exit.Exit<never, Error>[] = []
  const writes: Array<{ attempted: SessionV1.Assistant; before: SessionV1.WithParts; delegated: boolean }> = []
  const source = Layer.succeed(
    LLM.Service,
    LLM.Service.of({
      stream: (input) =>
        Stream.suspend(() => {
          // Count execution, including out-of-plan requests, not Effect construction.
          invocations++
          if (input.sessionID !== targetSession || invocations !== 1)
            return Stream.fail(new Error("G8 unexpected LLM invocation"))
          return Stream.concat(
            Stream.fromIterable(activity).pipe(Stream.tap((event) => Effect.sync(() => emitted.push(event)))),
            Stream.fromEffect(
              Effect.gen(function* () {
                if (!ready || !release) return yield* Effect.die("G8 source gates not initialized")
                // The preceding normalized handlers have returned; the actual
                // PartDelta listener must have identified this assistant.
                beforeCleanup = structuredClone(yield* inspect)
                yield* Deferred.succeed(ready, undefined)
                if (fixture.ending === "fatal") {
                  yield* Deferred.await(release)
                  primaryEmissions++
                  return yield* Effect.fail(primary)
                }
                return yield* Effect.never
              }).pipe(Effect.onExit((exit) => Effect.sync(() => sourceExits.push(exit)))),
            ),
          )
        }),
    }),
  )
  const implementation = SessionProcessor.node.implementation
  if (!Layer.isLayer(implementation)) throw new Error("G8 processor implementation is not a Layer")
  const processor = {
    ...SessionProcessor.node,
    implementation: Layer.updateService(implementation, Session.Service, (real) =>
      Session.Service.of({
        ...real,
        updateMessage: <T extends SessionV1.Info>(msg: T): Effect.Effect<T> =>
          Effect.gen(function* () {
            const info: SessionV1.Info = msg
            if (
              info.role === "assistant" &&
              info.sessionID === targetSession &&
              info.id === targetMessage &&
              info.time.completed !== undefined
            ) {
              const messages = yield* real.messages({ sessionID: info.sessionID }).pipe(Effect.orDie)
              const before = messages.find((item) => item.info.id === info.id)
              if (!before) return yield* Effect.die("G8 missing pre-write durable assistant")
              memory = info
              const write = { attempted: structuredClone(info), before: structuredClone(before), delegated: false }
              writes.push(write)
              if (fixture.fault) {
                faultHits++
                // Persistent for every matching write; never fail once and heal.
                // E=never at this boundary: model a persistence defect, not a cast Fail.
                return yield* Effect.die(storage)
              }
              write.delegated = true
            }
            return yield* real.updateMessage(msg)
          }),
      }),
    ),
  }
  const g8Prompt = testEffect(
    LayerNode.compile(promptRoot, [
      [SessionSummary.node, summary],
      [LSP.node, lsp],
      [MCP.node, makeMcp()],
      [RuntimeFlags.node, runtimeFlags],
      [LLM.node, source],
      [SessionProcessor.node, processor],
    ]),
  )
  g8Prompt.instance(
    `session.prompt G8 ${fixture.name}`,
    () =>
      Effect.gen(function* () {
        yield* Effect.sync(() => {
          targetMessage = undefined
          beforeCleanup = undefined
          memory = undefined
          invocations = primaryEmissions = faultHits = 0
          emitted.length = sourceExits.length = writes.length = 0
        })
        ready = yield* Deferred.make<void>()
        release = yield* Deferred.make<void>()
        const started = ready
        const gate = release
        const { prompt, sessions, chat } = yield* boot({ title: "G8 pinned prompt" })
        targetSession = chat.id
        const database = yield* Database.Service
        const events = yield* EventV2Bridge.Service
        const status = yield* SessionStatus.Service
        const history = yield* seed(chat.id, { finish: "stop" })
        history.assistant.time.completed = history.assistant.time.created + 1
        yield* sessions.updateMessage(history.assistant)
        yield* sessions.updatePart({
          id: PartID.ascending(),
          sessionID: chat.id,
          messageID: history.assistant.id,
          type: "step-finish",
          reason: "stop",
          cost: 0.25,
          tokens: { input: 13, output: 7, reasoning: 2, cache: { read: 3, write: 5 } },
        })
        const current = yield* user(chat.id, "G8 current request")
        const retained = structuredClone(yield* sessions.messages({ sessionID: chat.id }))
        const errors: NonNullable<SessionV1.Assistant["error"]>[] = []
        const retries: number[] = []
        const deltas: string[] = []
        const off = yield* events.listen((event) => {
          if (event.type === MessageV2.Event.PartDelta.type) {
            const data = event.data as typeof MessageV2.Event.PartDelta.data.Type
            if (data.sessionID === chat.id && data.field === "text" && data.delta === text) {
              targetMessage = data.messageID
              deltas.push(data.delta)
            }
          }
          if (event.type === Session.Event.Error.type) {
            const data = event.data as typeof Session.Event.Error.data.Type
            if (data.sessionID === chat.id && data.error) errors.push(structuredClone(data.error))
          }
          if (event.type === SessionStatus.Event.Status.type) {
            const data = event.data as typeof SessionStatus.Event.Status.data.Type
            if (data.sessionID === chat.id && data.status.type === "retry") retries.push(data.status.attempt)
          }
          return Effect.void
        })
        yield* Effect.addFinalizer(() => Deferred.succeed(gate, undefined).pipe(Effect.andThen(off)))
        // Capture the real Database once. The stream observer has no remaining
        // environment requirements and never resolves a second service graph.
        inspect = Effect.suspend(() => {
          if (!targetMessage) return Effect.die("G8 emitted PartDelta did not identify the assistant")
          return MessageV2.get({ sessionID: chat.id, messageID: targetMessage }).pipe(
            Effect.orDie,
            Effect.provideService(Database.Service, database),
          )
        })
        const run = yield* prompt.loop({ sessionID: chat.id }).pipe(Effect.forkChild)
        let cancelExit: Exit.Exit<void, never> | undefined
        let drained: Exit.Exit<SessionV1.WithParts, never> | undefined
        let cancellations = 0
        const driven = yield* Effect.gen(function* () {
          const result = yield* awaitWithTimeout(
            Effect.raceFirst(
              Deferred.await(started).pipe(Effect.as("source" as const)),
              Fiber.await(run).pipe(Effect.as("completed" as const)),
            ),
            "G8 source did not consume the head before prompt completion",
            "10 seconds",
          )
          if (result !== "source") throw new Error("G8 prompt completed before source readiness")
          if (fixture.driver) return yield* Effect.fail(driverFailure)
          if (fixture.ending === "cancel") {
            cancellations++
            cancelExit = yield* awaitWithTimeout(
              prompt.cancel(chat.id).pipe(Effect.exit),
              "G8 actual runner cancellation did not finish",
              "5 seconds",
            )
          } else yield* Deferred.succeed(gate, undefined)
          return yield* awaitWithTimeout(Fiber.await(run), "G8 prompt waiter did not finish", "10 seconds")
        }).pipe(
          // Same actual-runner cancellation/drain structure as G6/G7. Inspect
          // nested Exit values: Fiber.await failing work is itself successful.
          Effect.onExit((exit) =>
            Exit.isSuccess(exit)
              ? Effect.void
              : Effect.gen(function* () {
                  yield* Deferred.succeed(gate, undefined)
                  yield* awaitWithTimeout(
                    Effect.gen(function* () {
                      cancellations++
                      cancelExit = yield* prompt.cancel(chat.id).pipe(Effect.exit)
                      drained = yield* Fiber.await(run)
                      if (Exit.isFailure(cancelExit) && Exit.isFailure(drained))
                        return yield* Effect.failCause(Cause.combine(cancelExit.cause, drained.cause))
                      if (Exit.isFailure(cancelExit)) return yield* Effect.failCause(cancelExit.cause)
                      if (Exit.isFailure(drained)) return yield* Effect.failCause(drained.cause)
                    }),
                    "G8 actual runner cancellation/drain did not finish",
                    "5 seconds",
                  )
                }).pipe(
                  Effect.exit,
                  Effect.flatMap((cleanup) =>
                    Exit.isFailure(cleanup) ? Effect.failCause(Cause.combine(exit.cause, cleanup.cause)) : Effect.void,
                  ),
                ),
          ),
          Effect.exit,
        )
        if (!fixture.driver && Exit.isFailure(driven)) return yield* Effect.failCause(driven.cause)
        const ended = Exit.isSuccess(driven) ? driven.value : drained
        if (!ended) throw new Error("G8 missing observed prompt Exit")
        if (!targetMessage || !beforeCleanup || !memory) throw new Error("G8 final writer prerequisite not reached")
        const stored = yield* MessageV2.get({ sessionID: chat.id, messageID: targetMessage })
        if (stored.info.role !== "assistant" || beforeCleanup.info.role !== "assistant")
          throw new Error("G8 expected current assistant rows")
        const messages = yield* sessions.messages({ sessionID: chat.id })
        const observedStatus = yield* status.get(chat.id)
        const write = writes[0]
        if (!write) throw new Error("G8 missing final-write observation")
        const expectedError: NonNullable<SessionV1.Assistant["error"]> =
          fixture.ending === "fatal"
            ? { name: "UnknownError", data: { message: primary.message } }
            : { name: "MessageAbortedError", data: { message: "Aborted" } }
        const failures = Exit.isFailure(ended) ? ended.cause.reasons.filter(Cause.isFailReason) : []
        const defects = Exit.isFailure(ended) ? ended.cause.reasons.filter(Cause.isDieReason) : []
        console.log(
          "G8 prompt observation",
          JSON.stringify({
            fixture: fixture.name,
            scope: "processor Session writer, pre-delegation; caller Session healthy; normalized source",
            invocations,
            primaryEmissions,
            faultHits,
            cancellations,
            cancel: cancelExit ? (Exit.isSuccess(cancelExit) ? "success" : "failure") : "not called",
            waiter: Exit.isSuccess(ended) ? "success" : "failure",
            primaryIdentity: failures.some((reason) => reason.error === primary),
            storageIdentity: defects.some((reason) => reason.defect === storage),
            interrupted: Exit.isFailure(ended) && Cause.hasInterrupts(ended.cause),
            memory: { error: memory.error, finish: memory.finish, completed: memory.time.completed !== undefined },
            durable: {
              error: stored.info.error,
              finish: stored.info.finish,
              completed: stored.info.time.completed !== undefined,
            },
            idle: observedStatus.type === "idle",
          }),
        )
        // Assert only after the runner/waiter has exited. Idle is recorded, not
        // used as evidence that the failed assistant write reached persistence.
        expect(invocations).toBe(1)
        expect(primaryEmissions).toBe(fixture.ending === "fatal" ? 1 : 0)
        expect(emitted).toEqual(activity)
        expect(deltas).toEqual([text])
        expect(retries).toEqual([])
        expect(writes).toHaveLength(1)
        expect(faultHits).toBe(fixture.fault ? 1 : 0)
        expect(write.delegated).toBe(!fixture.fault)
        expect(memory).toEqual(write.attempted)
        expect(memory.error).toEqual(expectedError)
        expect(memory.finish).toBeUndefined()
        expect(memory.structured).toBeUndefined()
        expect(memory.time.completed).toEqual(expect.any(Number))
        expect(errors).toEqual([expectedError])
        expect(beforeCleanup.info.time.completed).toBeUndefined()
        expect(beforeCleanup.info.error).toBeUndefined()
        expect(write.before.info).toEqual(beforeCleanup.info)
        expect(stored.parts).toEqual(write.before.parts)
        expect(stored.parts).toEqual(
          beforeCleanup.parts.map((part) => {
            if (part.type !== "text") return part
            if (!part.time || typeof part.time.start !== "number") throw new Error("G8 open text has no start time")
            return { ...part, text, time: { start: part.time.start, end: expect.any(Number) }, metadata }
          }),
        )
        expect(stored.parts.filter((part) => part.type === "text")).toHaveLength(1)
        expect(messages.filter((item) => retained.some((old) => old.info.id === item.info.id))).toEqual(retained)
        expect(messages.filter((item) => !retained.some((old) => old.info.id === item.info.id))).toEqual([stored])
        expect(stored.info.parentID).toBe(current.id)
        expect(sourceExits).toHaveLength(1)
        const sourceExit = sourceExits[0]
        if (!sourceExit || !Exit.isFailure(sourceExit)) throw new Error("G8 source did not record its terminal Cause")
        if (fixture.ending === "fatal")
          expect(
            sourceExit.cause.reasons.some((reason) => Cause.isFailReason(reason) && reason.error === primary),
          ).toBe(true)
        else {
          expect(Cause.hasInterrupts(sourceExit.cause)).toBe(true)
          expect(cancellations).toBe(1)
          expect(cancelExit && Exit.isSuccess(cancelExit)).toBe(true)
        }
        if (fixture.fault) {
          expect(stored).toEqual(write.before)
          expect(stored.info.time.completed).toBeUndefined()
          expect(stored.info.error).toBeUndefined()
          expect(Exit.isFailure(ended)).toBe(true)
          expect(defects.some((reason) => reason.defect === storage)).toBe(true)
          if (fixture.driver) {
            if (!Exit.isFailure(driven)) throw new Error("G8 forced driver unexpectedly succeeded")
            expect(
              driven.cause.reasons.some((reason) => Cause.isFailReason(reason) && reason.error === driverFailure),
            ).toBe(true)
            expect(driven.cause.reasons.some((reason) => Cause.isDieReason(reason) && reason.defect === storage)).toBe(
              true,
            )
            expect(drained).toEqual(ended)
          } else if (fixture.ending === "fatal") {
            // Desired P9 preservation, not an assertion that ordinary healthy
            // provider errors must escape instead of returning stored errors.
            expect(failures.some((reason) => reason.error === primary)).toBe(true)
          } else expect(Exit.isFailure(ended) && Cause.hasInterrupts(ended.cause)).toBe(true)
        } else {
          expect(Exit.isSuccess(ended)).toBe(true)
          if (!Exit.isSuccess(ended)) return yield* Effect.failCause(ended.cause)
          expect(ended.value).toEqual(stored)
          expect(stored.info).toEqual(write.attempted)
          expect(stored.info.error).toEqual(expectedError)
          expect(stored.info.time.completed).toEqual(expect.any(Number))
          expect(stored.info.finish).toBeUndefined()
          expect(stored.info.structured).toBeUndefined()
        }
      }),
    { config: { ...cfg, compaction: { auto: false } } },
    20000,
  )
}
// End G8 prompt persistence fixtures.

// BEGIN G9 bounded Legacy turn/run and pre-main usage controls.
// R29 is paired with the existing G7 "R25 retained old user isolates episode
// allowance" negative, not another copy of it. A positive second recovery does
// not prove reset of an allowance/latch absent from this baseline. R28 below is
// only the reachable pre-main usage path, not a pending post-recovery token.
// Same-user continuation reset, same-handle reuse, and exact waiter joins remain
// outside this group: neither new IDs nor a fork/entry signal proves them.
type G9Plan = {
  phase: string
  model: string
  response: "fatal" | "overflow" | "stop" | "hang"
  input?: number
}

const g9Drive = <E, R>(input: {
  prompt: SessionPrompt.Interface
  sessionID: SessionID
  work: Effect.Effect<SessionV1.WithParts, E, R>
  forced?: { ready: Deferred.Deferred<void>; error: Error }
  // Test-driver-only observation seams; neither replaces production cancellation
  // nor changes the actual runner's work or persistence finalizers.
  probe?: {
    waiter: (fiber: Fiber.Fiber<SessionV1.WithParts, E>) => void
    cancelled: (exit: Exit.Exit<void, never>) => Effect.Effect<void>
    drainTimeout?: Duration.Input
  }
}) =>
  Effect.gen(function* () {
    const waiter = yield* input.work.pipe(Effect.forkChild)
    input.probe?.waiter(waiter)
    let drained: Exit.Exit<SessionV1.WithParts, E> | undefined
    let cancelled: Exit.Exit<void, never> | undefined
    let cancellations = 0
    // g7Prompt.instance uses test/lib/effect.ts's liveLayer, so these readiness
    // and drain timeouts cannot freeze behind a TestClock.
    const driven = yield* Effect.gen(function* () {
      if (input.forced) {
        const ready = yield* awaitWithTimeout(
          Effect.raceFirst(
            Deferred.await(input.forced.ready).pipe(Effect.as("request" as const)),
            Fiber.await(waiter).pipe(Effect.as("completed" as const)),
          ),
          "G9 active request not observed before completion",
          "10 seconds",
        )
        if (ready !== "request") return yield* Effect.fail(new Error("G9 runner completed before request readiness"))
        return yield* Effect.fail(input.forced.error)
      }
      return yield* awaitWithTimeout(Fiber.await(waiter), "G9 prompt waiter did not finish", "10 seconds")
    }).pipe(
      Effect.onExit((exit) =>
        Exit.isSuccess(exit)
          ? Effect.void
          : awaitWithTimeout(
              Effect.gen(function* () {
                cancellations++
                // Interrupt the actual runner, not just its waiting prompt fiber.
                cancelled = yield* input.prompt.cancel(input.sessionID).pipe(Effect.exit)
                if (input.probe) yield* input.probe.cancelled(cancelled)
                drained = yield* Fiber.await(waiter)
                // Fiber.await returns an Exit as a VALUE. Observe both layers.
                if (Exit.isFailure(cancelled) && Exit.isFailure(drained))
                  return yield* Effect.failCause(Cause.combine(cancelled.cause, drained.cause))
                if (Exit.isFailure(cancelled)) return yield* Effect.failCause(cancelled.cause)
                if (Exit.isFailure(drained)) return yield* Effect.failCause(drained.cause)
              }),
              "G9 actual runner cancellation/drain did not finish",
              input.probe?.drainTimeout ?? "5 seconds",
            ).pipe(
              Effect.exit,
              Effect.flatMap((cleanup) =>
                Exit.isFailure(cleanup) ? Effect.failCause(Cause.combine(exit.cause, cleanup.cause)) : Effect.void,
              ),
            ),
      ),
      Effect.exit,
    )
    // A failed or unassigned drain cannot replace the primary driver failure
    // and its already-combined secondary Cause. Only the deliberately failed
    // drive with a confirmed successful drain returns an observation normally.
    if (Exit.isFailure(driven) && (!input.forced || !drained || Exit.isFailure(drained)))
      return yield* Effect.failCause(driven.cause)
    const ended = Exit.isSuccess(driven) ? driven.value : drained
    if (!ended) return yield* Effect.fail(new Error("G9 missing observed waiter Exit"))
    if (Exit.isFailure(ended)) return yield* Effect.failCause(ended.cause)
    return { result: ended.value, driven, drained, cancelled, cancellations }
  })

const g9Cases = [
  { mode: "fatal-reentry", name: "R22 actual fatal without finish does not restart the failed turn" },
  { mode: "overflow-reentry", name: "R22 actual disabled overflow finish error stops same-turn reentry" },
  { mode: "new-user", name: "R22 actual fatal does not block a genuinely new ordinary user" },
  { mode: "new-run", name: "R29 completed recovery then new ordinary user permits independent recovery" },
  { mode: "usage", name: "R28 smaller-model new user triggers pre-main usage summary before main" },
  { mode: "driver", name: "failed driver cancels actual runner and observes nested waiter Exit" },
  { mode: "driver-secondary", name: "driver retains primary with test-local waiter finalizer failure after cancel" },
  { mode: "driver-timeout", name: "driver retains primary with unassigned drain then releases owned waiter" },
] as const

for (const fixture of g9Cases) {
  g7Prompt.instance(
    `session.prompt G9 ${fixture.name}`,
    () =>
      Effect.gen(function* () {
        const driver =
          fixture.mode === "driver" || fixture.mode === "driver-secondary" || fixture.mode === "driver-timeout"
        const driverProbe = fixture.mode === "driver-secondary" || fixture.mode === "driver-timeout"
        const mainModel = "test-model"
        const summaryModel = "g9-summary"
        const largeModel = "g9-large"
        const smallModel = "g9-small"
        const planned: G9Plan[] =
          fixture.mode === "new-run"
            ? [
                { phase: "first-main", model: mainModel, response: "overflow" },
                { phase: "first-summary", model: summaryModel, response: "stop" },
                { phase: "first-post-main", model: mainModel, response: "stop" },
                { phase: "second-main", model: mainModel, response: "overflow" },
                { phase: "second-summary", model: summaryModel, response: "stop" },
                { phase: "second-post-main", model: mainModel, response: "stop" },
              ]
            : fixture.mode === "usage"
              ? [
                  { phase: "large-setup", model: largeModel, response: "stop", input: 200000 },
                  { phase: "usage-summary", model: summaryModel, response: "stop" },
                  { phase: "post-usage-main", model: smallModel, response: "stop" },
                ]
              : driver
                ? [{ phase: "active-main", model: mainModel, response: "hang" }]
                : [
                    {
                      phase: "initial-failure",
                      model: mainModel,
                      response: fixture.mode === "overflow-reentry" ? "overflow" : "fatal",
                    },
                    ...(fixture.mode === "new-user"
                      ? [{ phase: "new-user-main", model: mainModel, response: "stop" as const }]
                      : []),
                  ]
        const fatalBody = { error: { code: "g9_fatal", message: "G9 nonretryable fatal sentinel" } }
        const overflowBody = { error: { code: "context_length_exceeded", message: "g9 opaque overflow detail" } }
        const overrunBody = { error: { code: "g9_overrun", message: "G9 unexpected request sentinel" } }
        const responseText = (plan: G9Plan) => `G9 ${plan.phase} completed answer`
        const calls: Array<{ ordinal: number; plan: G9Plan; body: Record<string, unknown>; overrun: boolean }> = []
        const active = yield* Deferred.make<void>()
        const server = yield* Effect.acquireRelease(
          Effect.sync(() =>
            Bun.serve({
              hostname: "127.0.0.1",
              port: 0,
              async fetch(request) {
                const ordinal = calls.length
                const plan: G9Plan = planned[ordinal] ?? { phase: "unexpected", model: "unexpected", response: "fatal" }
                const call = {
                  ordinal: ordinal + 1,
                  plan,
                  body: {} as Record<string, unknown>,
                  overrun: !planned[ordinal],
                }
                calls.push(call) // Count all real executions, including malformed and overrun requests.
                call.body = await request.json().catch(() => ({}))
                if (call.overrun || plan.response === "fatal" || plan.response === "overflow")
                  return Response.json(
                    call.overrun ? overrunBody : plan.response === "fatal" ? fatalBody : overflowBody,
                    {
                      status: plan.response === "overflow" ? 400 : 401,
                    },
                  )
                if (plan.response === "hang") {
                  const body = new ReadableStream<Uint8Array>({
                    start(controller) {
                      controller.enqueue(
                        new TextEncoder().encode('data: {"choices":[{"delta":{"role":"assistant"}}]}\n\n'),
                      )
                    },
                  })
                  succeedVoid(active)
                  return new Response(body, { headers: { "content-type": "text/event-stream" } })
                }
                const input = plan.input ?? 3
                return new Response(
                  [
                    { choices: [{ delta: { role: "assistant", content: responseText(plan) } }] },
                    {
                      choices: [{ delta: {}, finish_reason: "stop" }],
                      usage: { prompt_tokens: input, completion_tokens: 2, total_tokens: input + 2 },
                    },
                  ]
                    .map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`)
                    .join("") + "data: [DONE]\n\n",
                  { headers: { "content-type": "text/event-stream" } },
                )
              },
            }),
          ),
          (server) => Effect.promise(() => server.stop(true)),
        )
        const { directory } = yield* TestInstance
        const base = providerCfg(`http://127.0.0.1:${server.port}/v1`)
        const { id: _alias, ...model } = base.provider.test.models["test-model"]
        yield* writeConfig(directory, {
          ...base,
          provider: {
            ...base.provider,
            test: {
              ...base.provider.test,
              models: {
                [mainModel]: model,
                [summaryModel]: { ...model, name: "G9 Summary", limit: { context: 1000000, output: 10000 } },
                [largeModel]: { ...model, name: "G9 Large", limit: { context: 1000000, output: 10000 } },
                [smallModel]: { ...model, name: "G9 Small", limit: { context: 100000, output: 10000 } },
              },
            },
          },
          agent: { compaction: { model: `test/${summaryModel}` } },
          compaction: {
            auto: fixture.mode !== "overflow-reentry",
            prune: false,
            tail_turns: 1,
            preserve_recent_tokens: 10000,
          },
        })
        const { prompt, sessions, chat } = yield* boot({ title: "G9 pinned nondefault title" })
        const status = yield* SessionStatus.Service
        const events = yield* EventV2Bridge.Service
        const handles: SessionProcessor.Handle[] = []
        const histories: Array<{ messageID: MessageID; messages: SessionV1.WithParts[] }> = []
        g7Creates.set(chat.id, handles)
        g7Histories.set(chat.id, histories)
        yield* Effect.addFinalizer(() =>
          Effect.sync(() => {
            g7Creates.delete(chat.id)
            g7Histories.delete(chat.id)
          }),
        )
        const errors: NonNullable<SessionV1.Assistant["error"]>[] = []
        const retries: number[] = []
        let compacted = 0
        const off = yield* events.listen((event) => {
          if (event.type === Session.Event.Error.type) {
            const data = event.data as typeof Session.Event.Error.data.Type
            if (data.sessionID === chat.id && data.error) errors.push(data.error)
          }
          if (event.type === SessionStatus.Event.Status.type) {
            const data = event.data as typeof SessionStatus.Event.Status.data.Type
            if (data.sessionID === chat.id && data.status.type === "retry") retries.push(data.status.attempt)
          }
          if (event.type === SessionCompaction.Event.Compacted.type) {
            const data = event.data as typeof SessionCompaction.Event.Compacted.data.Type
            if (data.sessionID === chat.id) compacted++
          }
          return Effect.void
        })
        yield* Effect.addFinalizer(() => off)
        // Seed only old history. Both current user submissions below use the
        // real prompt() path; no failed/finished current assistant is fabricated.
        if (fixture.mode === "new-run") {
          for (const text of ["G9 old ordinary U0", "G9 retained ordinary U1"]) {
            const parent = yield* user(chat.id, text)
            const old: SessionV1.Assistant = {
              id: MessageID.ascending(),
              role: "assistant",
              sessionID: chat.id,
              parentID: parent.id,
              agent: "build",
              mode: "build",
              modelID: ref.modelID,
              providerID: ref.providerID,
              path: { cwd: directory, root: directory },
              cost: 0,
              tokens: { input: 3, output: 2, reasoning: 0, cache: { read: 0, write: 0 } },
              finish: "stop",
              time: { created: Date.now(), completed: Date.now() },
            }
            yield* sessions.updateMessage(old)
            yield* sessions.updatePart({
              id: PartID.ascending(),
              messageID: old.id,
              sessionID: chat.id,
              type: "text",
              text: `${text} completed answer`,
              time: { start: Date.now(), end: Date.now() },
            })
            yield* sessions.updatePart({
              id: PartID.ascending(),
              messageID: old.id,
              sessionID: chat.id,
              type: "step-finish",
              reason: "stop",
              tokens: old.tokens,
              cost: old.cost,
            })
          }
        }
        const initialHistory = structuredClone(yield* sessions.messages({ sessionID: chat.id }))
        const firstText = `G9 ${fixture.mode} ordinary first user`
        const nextText = `G9 ${fixture.mode} genuinely new ordinary user`
        const send = (text: string, modelID: string) =>
          prompt.prompt({
            sessionID: chat.id,
            agent: "build",
            model: { providerID: ref.providerID, modelID: ModelV2.ID.make(modelID) },
            parts: [{ type: "text", text }],
          })
        const primary = new Error("G9 deliberately failed active driver")
        const secondary = new Error("G9 test-local waiter finalizer failure")
        const cancelReturned = yield* Deferred.make<void>()
        const waiterFinalizer = yield* Deferred.make<void>()
        const releaseWaiter = yield* Deferred.make<void>()
        let ownedWaiter: Fiber.Fiber<SessionV1.WithParts, unknown> | undefined
        let actualCancel: Exit.Exit<void, never> | undefined
        let finalizerReachedBeforeRelease = false
        let released: Exit.Exit<Exit.Exit<SessionV1.WithParts, unknown>, unknown> | undefined
        const source = send(firstText, fixture.mode === "usage" ? largeModel : mainModel)
        const work = driverProbe
          ? source.pipe(
              // This finalizer belongs ONLY to the test's prompt waiter, not
              // processor cleanup, run-state, storage, or the physical runner.
              Effect.onExit(() =>
                Effect.gen(function* () {
                  yield* Deferred.await(cancelReturned)
                  yield* Deferred.succeed(waiterFinalizer, undefined)
                  if (fixture.mode === "driver-secondary") return yield* Effect.fail(secondary)
                  yield* Deferred.await(releaseWaiter)
                }),
              ),
            )
          : source
        const firstExit = yield* g9Drive({
          prompt,
          sessionID: chat.id,
          work,
          ...(driver ? { forced: { ready: active, error: primary } } : {}),
          ...(driverProbe
            ? {
                probe: {
                  waiter: (fiber: Fiber.Fiber<SessionV1.WithParts, unknown>) => {
                    ownedWaiter = fiber
                  },
                  cancelled: (exit: Exit.Exit<void, never>) =>
                    Effect.gen(function* () {
                      actualCancel = exit
                      yield* Deferred.succeed(cancelReturned, undefined)
                    }),
                  drainTimeout: "1 second",
                },
              }
            : {}),
        }).pipe(
          Effect.onExit((exit) =>
            !driverProbe
              ? Effect.void
              : Effect.gen(function* () {
                  // Even a failed/missing driver drain owns its waiting fiber.
                  // Release both local gates on every exit, then observe the
                  // inner Exit; a timeout never means an uninterruptible
                  // finalizer was forcibly killed.
                  finalizerReachedBeforeRelease = yield* Deferred.isDone(waiterFinalizer)
                  released = yield* awaitWithTimeout(
                    Effect.gen(function* () {
                      yield* Deferred.succeed(cancelReturned, undefined)
                      yield* Deferred.succeed(releaseWaiter, undefined)
                      if (!ownedWaiter) return yield* Effect.fail(new Error("G9 missing owned waiter"))
                      return yield* Fiber.await(ownedWaiter)
                    }),
                    "G9 released local waiter did not drain",
                    "5 seconds",
                  ).pipe(Effect.exit)
                  if (Exit.isFailure(released))
                    return yield* Effect.failCause(
                      Exit.isFailure(exit) ? Cause.combine(exit.cause, released.cause) : released.cause,
                    )
                }),
          ),
          Effect.exit,
        )
        if (driverProbe) {
          const rows = yield* sessions.messages({ sessionID: chat.id })
          const handle = handles[0]
          if (!handle) throw new Error("G9 probe missing real processor handle")
          const stored = yield* MessageV2.get({ sessionID: chat.id, messageID: handle.message.id })
          console.log(
            "G9 driver probe observation",
            JSON.stringify({
              fixture: fixture.name,
              planned,
              calls,
              firstExit,
              actualCancel,
              finalizerReachedBeforeRelease,
              released,
              stored,
              errors,
            }),
          )
          expect(actualCancel).toEqual(Exit.succeed(undefined))
          expect(finalizerReachedBeforeRelease).toBe(true)
          expect(yield* Deferred.isDone(waiterFinalizer)).toBe(true)
          expect(Exit.isFailure(firstExit)).toBe(true)
          if (!Exit.isFailure(firstExit)) throw new Error("G9 driver probe unexpectedly succeeded")
          const failures = firstExit.cause.reasons.filter(Cause.isFailReason).map((reason) => reason.error)
          expect(failures).toHaveLength(2)
          expect(failures[0]).toBe(primary)
          expect(firstExit.cause.reasons.some(Cause.isDieReason)).toBe(false)
          expect(firstExit.cause.reasons.some(Cause.isInterruptReason)).toBe(false)
          if (!released || !Exit.isSuccess(released)) throw new Error("G9 local waiter release was not confirmed")
          if (fixture.mode === "driver-secondary") {
            expect(failures[1]).toBe(secondary)
            expect(Exit.isFailure(released.value)).toBe(true)
            if (!Exit.isFailure(released.value)) throw new Error("G9 local waiter secondary failure missing")
            expect(released.value.cause.reasons.filter(Cause.isFailReason).map((reason) => reason.error)).toEqual([
              secondary,
            ])
          } else {
            expect(failures[1]).toBeInstanceOf(Error)
            expect((failures[1] as Error).message).toBe("G9 actual runner cancellation/drain did not finish")
            expect(released.value).toEqual(Exit.succeed(stored))
          }
          expect(
            calls.map((call) => ({ phase: call.plan.phase, model: call.body.model, overrun: call.overrun })),
          ).toEqual([{ phase: "active-main", model: mainModel, overrun: false }])
          expect(handles).toHaveLength(1)
          expect(stored.info).toEqual(handle.message)
          if (stored.info.role !== "assistant") throw new Error("G9 probe expected assistant")
          if (!stored.info.error) throw new Error("G9 probe missing durable abort error")
          expect(stored.info.time.completed).toEqual(expect.any(Number))
          expect(stored.info.error).toEqual({ name: "MessageAbortedError", data: { message: "Aborted" } })
          expect(stored.info.finish).toBeUndefined()
          expect(stored.info.structured).toBeUndefined()
          const parent = rows.find((row) => row.info.id === handle.message.parentID)
          expect(parent?.info.role).toBe("user")
          expect(parent?.parts).toEqual([
            expect.objectContaining({ type: "text", text: firstText, messageID: handle.message.parentID }),
          ])
          expect(
            stored.parts.some((part) => part.type === "text" || part.type === "step-finish" || part.type === "tool"),
          ).toBe(false)
          expect(rows.flatMap((row) => row.parts).some((part) => part.type === "compaction")).toBe(false)
          expect(errors).toEqual([stored.info.error])
          expect(retries).toEqual([])
          expect(compacted).toBe(0)
          expect(yield* status.get(chat.id)).toEqual({ type: "idle" })
          return
        }
        if (Exit.isFailure(firstExit)) return yield* Effect.failCause(firstExit.cause)
        const first = firstExit.value
        const firstResult = structuredClone(first.result)
        const firstStored = yield* MessageV2.get({ sessionID: chat.id, messageID: firstResult.info.id })
        const firstRows = structuredClone(yield* sessions.messages({ sessionID: chat.id }))
        const firstStatus = yield* status.get(chat.id)
        const firstCalls = calls.length
        const firstHandles = handles.length
        expect(firstResult).toEqual(firstStored)
        expect(firstStatus).toEqual({ type: "idle" })
        if (firstStored.info.role !== "assistant") throw new Error("G9 expected first assistant")
        expect(firstStored.info.time.completed).toEqual(expect.any(Number))
        expect(firstStored.info.structured).toBeUndefined()
        const overflowError: NonNullable<SessionV1.Assistant["error"]> = {
          name: "ContextOverflowError",
          data: { message: "g9 opaque overflow detail", responseBody: JSON.stringify(overflowBody) },
        }
        const fatalError: NonNullable<SessionV1.Assistant["error"]> = {
          name: "APIError",
          data: {
            message: "G9 nonretryable fatal sentinel",
            statusCode: 401,
            isRetryable: false,
            responseHeaders: expect.any(Object),
            responseBody: JSON.stringify(fatalBody),
            metadata: { url: `http://127.0.0.1:${server.port}/v1/chat/completions` },
          },
        }
        // Entry prerequisites have their own oracle: error-only failure must
        // not accidentally inherit a helper's finish="error" or success flag.
        if (fixture.mode === "fatal-reentry" || fixture.mode === "new-user") {
          expect(firstStored.info.error).toEqual(fatalError)
          expect(firstStored.info.finish).toBeUndefined()
          expect(firstStored.parts.some((part) => part.type === "step-finish")).toBe(false)
        } else if (fixture.mode === "overflow-reentry") {
          expect(firstStored.info.error).toEqual(overflowError)
          expect(firstStored.info.finish).toBe("error")
        } else if (fixture.mode !== "driver") {
          expect(firstStored.info.error).toBeUndefined()
          expect(firstStored.info.finish).toBe("stop")
        }
        if (fixture.mode === "usage") {
          const provider = yield* ProviderSvc.Service
          const compaction = yield* SessionCompaction.Service
          const large = yield* provider.getModel(ref.providerID, ModelV2.ID.make(largeModel))
          const small = yield* provider.getModel(ref.providerID, ModelV2.ID.make(smallModel))
          const summary = yield* provider.getModel(ref.providerID, ModelV2.ID.make(summaryModel))
          expect(large.limit).toMatchObject({ context: 1000000, output: 10000 })
          expect(small.limit).toMatchObject({ context: 100000, output: 10000 })
          expect(summary.limit).toMatchObject({ context: 1000000, output: 10000 })
          expect(large.limit.input).toBeUndefined()
          expect(small.limit.input).toBeUndefined()
          expect(firstStored.info.tokens.input).toBe(200000)
          expect(firstStored.info.tokens.output).toBe(2)
          // Check the real configured predicate, including the actual reserve;
          // context size alone is not a substitute for this boundary.
          expect(yield* compaction.isOverflow({ tokens: firstStored.info.tokens, model: large })).toBe(false)
          expect(yield* compaction.isOverflow({ tokens: firstStored.info.tokens, model: small })).toBe(true)
          expect(firstCalls).toBe(1)
          expect(firstHandles).toBe(1)
          expect(compacted).toBe(0)
          expect(firstRows.flatMap((message) => message.parts).some((part) => part.type === "compaction")).toBe(false)
        }
        // The first waiter has completed (Runner finishes onIdle before its
        // shared done Deferred). The following call is sequential, not a join.
        const second =
          fixture.mode === "driver"
            ? undefined
            : yield* g9Drive({
                prompt,
                sessionID: chat.id,
                work:
                  fixture.mode === "fatal-reentry" || fixture.mode === "overflow-reentry"
                    ? prompt.loop({ sessionID: chat.id })
                    : send(nextText, fixture.mode === "usage" ? smallModel : mainModel),
              })
        const result = second?.result ?? first.result
        const stored = yield* MessageV2.get({ sessionID: chat.id, messageID: result.info.id })
        const rows = yield* sessions.messages({ sessionID: chat.id })
        const durable = yield* Effect.forEach(handles, (handle) =>
          MessageV2.get({ sessionID: chat.id, messageID: handle.message.id }),
        )
        const compactions = rows.flatMap((message) => message.parts.filter((part) => part.type === "compaction"))
        const userWithText = (text: string) => {
          const found = rows.find(
            (message) =>
              message.info.role === "user" &&
              message.parts.some((part) => part.type === "text" && part.text === text && !part.synthetic),
          )
          if (!found || found.info.role !== "user") throw new Error(`G9 missing ordinary user: ${text}`)
          return found
        }
        const historyFor = (index: number) => {
          const found = histories.find((entry) => entry.messageID === handles[index]?.message.id)?.messages
          if (!found) throw new Error(`G9 missing main admission history ${index}`)
          return found
        }
        console.log(
          "G9 prompt observation",
          JSON.stringify({
            fixture: fixture.name,
            planned,
            consumed: calls.map((call) => call.plan.phase),
            pending: planned.slice(calls.length),
            calls,
            firstBoundary: { calls: firstCalls, handles: firstHandles, status: firstStatus, result: firstResult },
            result,
            stored,
            durable,
            histories,
            compactions,
            errors,
            retries,
            compacted,
            driver: {
              cancellations: first.cancellations,
              driven: first.driven,
              cancelled: first.cancelled,
              drained: first.drained,
            },
          }),
        )
        expect(result).toEqual(stored)
        expect(yield* status.get(chat.id)).toEqual({ type: "idle" })
        expect(rows.filter((message) => firstRows.some((old) => old.info.id === message.info.id))).toEqual(firstRows)
        expect(rows.filter((message) => initialHistory.some((old) => old.info.id === message.info.id))).toEqual(
          initialHistory,
        )
        expect(retries).toEqual([])
        for (const [index, message] of durable.entries()) {
          expect(message.info).toEqual(handles[index].message)
          expect(message.info.role).toBe("assistant")
          if (message.info.role !== "assistant") throw new Error("G9 expected durable assistant")
          expect(message.info.time.completed).toEqual(expect.any(Number))
          expect(message.info.structured).toBeUndefined()
          for (const part of message.parts) {
            expect(part.sessionID).toBe(chat.id)
            expect(part.messageID).toBe(message.info.id)
          }
        }
        if (fixture.mode === "driver") {
          expect(first.cancellations).toBe(1)
          expect(first.cancelled).toEqual(Exit.succeed(undefined))
          expect(Exit.isFailure(first.driven)).toBe(true)
          if (!Exit.isFailure(first.driven)) throw new Error("G9 failed driver unexpectedly succeeded")
          expect(first.driven.cause.reasons.filter(Cause.isFailReason).map((reason) => reason.error)).toEqual([primary])
          expect(first.driven.cause.reasons.some(Cause.isDieReason)).toBe(false)
          expect(first.drained).toEqual(Exit.succeed(stored))
          if (stored.info.role !== "assistant") throw new Error("G9 expected aborted assistant")
          if (!stored.info.error) throw new Error("G9 missing durable abort error")
          expect(stored.info.error).toEqual({ name: "MessageAbortedError", data: { message: "Aborted" } })
          expect(stored.info.finish).toBeUndefined()
          expect(stored.info.parentID).toBe(userWithText(firstText).info.id)
          expect(calls).toHaveLength(1)
          expect(handles).toHaveLength(1)
          expect(compactions).toEqual([])
          expect(errors).toEqual([stored.info.error])
          return
        }
        expect(first.cancellations).toBe(0)
        expect(second?.cancellations).toBe(0)
        if (fixture.mode === "fatal-reentry" || fixture.mode === "overflow-reentry") {
          if (!firstStored.info.error) throw new Error("G9 reentry prerequisite missing first durable error")
          // Aggregate target assertion runs after both waiters have exited, so
          // the baseline's extra assistant/request is observed without a hang.
          expect({ requests: calls.length, handles: handles.length, result, rows, errors, compacted }).toEqual({
            requests: 1,
            handles: 1,
            result: firstResult,
            rows: firstRows,
            errors: [firstStored.info.error],
            compacted: 0,
          })
          return
        }
        expect(calls.map((call) => ({ ...call.plan, actualModel: call.body.model, overrun: call.overrun }))).toEqual(
          planned.map((plan) => ({ ...plan, actualModel: plan.model, overrun: false })),
        )
        expect(handles).toHaveLength(planned.length)
        expect(stored.info.role).toBe("assistant")
        if (stored.info.role !== "assistant") throw new Error("G9 expected final assistant")
        expect(stored.info.finish).toBe("stop")
        expect(stored.info.error).toBeUndefined()
        const latestUser = userWithText(nextText)
        expect(latestUser.info.id).not.toBe(userWithText(firstText).info.id)
        expect(latestUser.parts.every((part) => part.type !== "compaction")).toBe(true)
        for (const [index, plan] of planned.entries()) {
          const message = durable[index]
          if (message.info.role !== "assistant") throw new Error("G9 expected planned assistant")
          expect(message.info.modelID).toBe(ModelV2.ID.make(plan.model))
          expect(message.info.summary === true).toBe(plan.model === summaryModel)
          expect(message.info.finish).toBe(plan.response === "stop" ? "stop" : undefined)
          expect(message.info.error).toEqual(plan.response === "fatal" ? fatalError : undefined)
          expect(
            message.parts
              .filter((part) => part.type === "text")
              .map((part) => part.text)
              .join(""),
          ).toBe(plan.response === "stop" ? responseText(plan) : "")
          expect(message.parts.filter((part) => part.type === "step-finish").map((part) => part.reason)).toEqual(
            plan.response === "stop" ? ["stop"] : [],
          )
        }
        if (fixture.mode === "new-user") {
          expect(stored.info.parentID).toBe(latestUser.info.id)
          expect(handles[0].message.parentID).toBe(userWithText(firstText).info.id)
          expect(errors).toEqual([fatalError])
          expect(compactions).toEqual([])
          expect(compacted).toBe(0)
          return
        }
        if (fixture.mode === "new-run") {
          expect(firstCalls).toBe(3)
          expect(firstHandles).toBe(3)
          expect(compactions).toHaveLength(2)
          expect(compacted).toBe(2)
          expect(errors).toEqual([overflowError, overflowError])
          expect(handles[0].message.parentID).toBe(userWithText(firstText).info.id)
          expect(handles[3].message.parentID).toBe(latestUser.info.id)
          for (const index of [0, 3]) {
            const history = historyFor(index)
            const currentID = handles[index].message.parentID
            expect(MessageV2.latest(history).user?.id).toBe(currentID)
            const currentIndex = history.findIndex((message) => message.info.id === currentID)
            const old = history
              .slice(0, currentIndex)
              .filter(
                (message) => message.info.role === "user" && !message.parts.some((part) => part.type === "compaction"),
              )
            expect(old.length).toBeGreaterThan(0)
            for (const message of old) {
              const original = rows.find((row) => row.info.id === message.info.id)
              if (!original) throw new Error("G9 retained ordinary history missing durable row")
              expect(message).toEqual(original)
            }
            expect(compactions[index / 3].auto).toBe(true)
            expect(compactions[index / 3].overflow).toBe(true)
            expect(compactions[index / 3].tail_start_id).toBeDefined()
            expect(handles[index + 1].message.parentID).toBe(compactions[index / 3].messageID)
            const replay = rows.find((message) => message.info.id === handles[index + 2].message.parentID)
            const original = rows.find((message) => message.info.id === currentID)
            if (!replay || !original) throw new Error("G9 missing replay/original user")
            expect(replay.info.role).toBe("user")
            expect(replay.info.id).not.toBe(currentID)
            expect(replay.parts.map(({ id, messageID, ...payload }) => payload)).toEqual(
              original.parts.map(({ id, messageID, ...payload }) => payload),
            )
            expect(JSON.stringify(calls[index + 2].body.messages)).toContain(responseText(planned[index + 1]))
          }
          return
        }
        // R28: setup main is on large; no small main is admitted before usage
        // compaction. The synthetic continuation is NOT the ordinary U1.
        expect(fixture.mode).toBe("usage")
        expect(errors).toEqual([])
        expect(compacted).toBe(1)
        expect(compactions).toHaveLength(1)
        expect(compactions[0].auto).toBe(true)
        expect(compactions[0].overflow).toBeUndefined()
        expect(compactions[0].tail_start_id).toBe(latestUser.info.id)
        expect(handles[1].message.parentID).toBe(compactions[0].messageID)
        expect(handles[0].message.parentID).toBe(userWithText(firstText).info.id)
        const finalParentID = stored.info.parentID
        const followup = rows.find((message) => message.info.id === finalParentID)
        if (!followup || followup.info.role !== "user") throw new Error("G9 missing usage synthetic continuation")
        expect(followup.info.id).not.toBe(latestUser.info.id)
        expect(followup.parts).toHaveLength(1)
        expect(followup.parts[0]).toMatchObject({
          type: "text",
          synthetic: true,
          metadata: { compaction_continue: true },
          text: "Continue if you have next steps, or stop and ask for clarification if you are unsure how to proceed.",
        })
        const admission = historyFor(2)
        expect(MessageV2.latest(admission).user?.id).toBe(followup.info.id)
        expect(admission.find((message) => message.info.id === latestUser.info.id)).toEqual(latestUser)
        expect(admission.findIndex((message) => message.info.id === latestUser.info.id)).toBeLessThan(
          admission.findIndex((message) => message.info.id === followup.info.id),
        )
        expect(JSON.stringify(calls[2].body.messages)).toContain(nextText)
        expect(JSON.stringify(calls[2].body.messages)).toContain(responseText(planned[1]))
      }),
    30000,
  )
}
// END G9 bounded Legacy turn/run and pre-main usage controls.

// Loop semantics

noLLMServer.instance(
  "loop exits immediately when last assistant has stop finish",
  () =>
    Effect.gen(function* () {
      const prompt = yield* SessionPrompt.Service
      const sessions = yield* Session.Service
      const chat = yield* sessions.create({ title: "Pinned" })
      yield* seed(chat.id, { finish: "stop" })

      const result = yield* prompt.loop({ sessionID: chat.id })
      expect(result.info.role).toBe("assistant")
      if (result.info.role === "assistant") expect(result.info.finish).toBe("stop")
    }),
  { config: cfg },
)

noLLMServer.instance(
  "loop exits for a completed parent turn with nonmonotonic message IDs",
  () =>
    Effect.gen(function* () {
      const prompt = yield* SessionPrompt.Service
      const sessions = yield* Session.Service
      const chat = yield* sessions.create({ title: "Pinned" })
      const userID = MessageID.make("msg_z_user")
      const assistantID = MessageID.make("msg_a_assistant")
      yield* sessions.updateMessage({
        id: userID,
        role: "user",
        sessionID: chat.id,
        agent: "build",
        model: ref,
        time: { created: 100 },
      })
      yield* sessions.updateMessage({
        id: assistantID,
        role: "assistant",
        parentID: userID,
        sessionID: chat.id,
        mode: "build",
        agent: "build",
        cost: 0,
        path: { cwd: "/tmp", root: "/tmp" },
        tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
        modelID: ref.modelID,
        providerID: ref.providerID,
        time: { created: 200, completed: 201 },
        finish: "stop",
      })

      const result = yield* prompt.loop({ sessionID: chat.id })

      expect(result.info.id).toBe(assistantID)
    }),
  { config: cfg },
)

it.instance("loop exits without an LLM request for interrupted orphan tool calls", () =>
  Effect.gen(function* () {
    const { llm } = yield* useServerConfig(providerCfg)
    const prompt = yield* SessionPrompt.Service
    const sessions = yield* Session.Service
    const chat = yield* sessions.create({ title: "Pinned" })
    const seeded = yield* seed(chat.id, { finish: "stop" })
    yield* sessions.updatePart({
      id: PartID.ascending(),
      messageID: seeded.assistant.id,
      sessionID: chat.id,
      type: "tool",
      callID: "interrupted-call",
      tool: "edit",
      state: {
        status: "error",
        input: {},
        error: "Tool execution aborted",
        metadata: { interrupted: true },
        time: { start: 1, end: 2 },
      },
    })

    const result = yield* prompt.loop({ sessionID: chat.id })
    expect(result.info.id).toBe(seeded.assistant.id)
    expect(yield* llm.hits).toHaveLength(0)
  }),
)

it.instance("loop calls LLM and returns assistant message", () =>
  Effect.gen(function* () {
    const { llm } = yield* useServerConfig(providerCfg)
    const prompt = yield* SessionPrompt.Service
    const sessions = yield* Session.Service
    const chat = yield* sessions.create({
      title: "Pinned",
      permission: [{ permission: "*", pattern: "*", action: "allow" }],
    })
    yield* prompt.prompt({
      sessionID: chat.id,
      agent: "build",
      noReply: true,
      parts: [{ type: "text", text: "hello" }],
    })
    yield* llm.text("world")

    const result = yield* prompt.loop({ sessionID: chat.id })
    expect(result.info.role).toBe("assistant")
    const parts = result.parts.filter((p) => p.type === "text")
    expect(parts.some((p) => p.type === "text" && p.text === "world")).toBe(true)
    expect(yield* llm.hits).toHaveLength(1)
  }),
)

withMcpInstructions.instance(
  "loop includes MCP instructions in model system context",
  () =>
    Effect.gen(function* () {
      const { llm } = yield* useServerConfig(providerCfg)
      const prompt = yield* SessionPrompt.Service
      const sessions = yield* Session.Service
      const chat = yield* sessions.create({
        title: "Pinned",
        permission: [{ permission: "*", pattern: "*", action: "allow" }],
      })
      yield* llm.hang
      yield* user(chat.id, "hello")

      const fiber = yield* prompt.loop({ sessionID: chat.id }).pipe(Effect.forkChild)
      yield* awaitWithTimeout(llm.wait(1), "timed out waiting for MCP instruction request", "10 seconds")

      const hits = yield* llm.hits
      const body = JSON.stringify(hits[0]?.body)
      expect(body).toContain('<server name=\\"guide-server\\">')
      expect(body).toContain("Use lookup before mutate.")
      yield* Fiber.interrupt(fiber)
    }),
  15_000,
)

it.instance("legacy prompt emits message events without session.next events", () =>
  Effect.gen(function* () {
    const events = yield* EventV2Bridge.Service
    const prompt = yield* SessionPrompt.Service
    const sessions = yield* Session.Service
    const chat = yield* sessions.create({
      title: "Pinned",
      agent: "plan",
      model: { providerID: ProviderV2.ID.make("old"), id: ModelV2.ID.make("old-model") },
    })
    const seen: string[] = []
    const off = yield* events.listen((event) => {
      seen.push(event.type)
      return Effect.void
    })

    const first = yield* prompt.prompt({
      sessionID: chat.id,
      agent: "build",
      model: ref,
      noReply: true,
      parts: [{ type: "text", text: "hello" }],
    })
    const second = yield* prompt.prompt({
      sessionID: chat.id,
      agent: "build",
      noReply: true,
      parts: [{ type: "text", text: "again" }],
    })
    yield* off

    expect(first.info.role).toBe("user")
    expect(second.info.role).toBe("user")
    if (first.info.role === "user" && second.info.role === "user") {
      expect(first.info.model).toEqual(ref)
      expect(second.info.model).toEqual(ref)
    }
    expect(yield* sessions.get(chat.id)).toMatchObject({
      agent: "build",
      model: { providerID: ref.providerID, id: ref.modelID },
    })
    expect(seen).toContain(Session.Event.Updated.type)
    expect(seen).toContain(MessageV2.Event.Updated.type)
    expect(seen).toContain(MessageV2.Event.PartUpdated.type)
    expect(seen.filter((type) => type.startsWith("session.next."))).toEqual([])
  }),
)

it.instance("loop surfaces content-filter finishes as session errors", () =>
  Effect.gen(function* () {
    const { llm } = yield* useServerConfig(providerCfg)
    const events = yield* EventV2Bridge.Service
    const prompt = yield* SessionPrompt.Service
    const sessions = yield* Session.Service
    const chat = yield* sessions.create({ title: "Pinned" })
    const errors: NonNullable<SessionV1.Assistant["error"]>[] = []
    const expected = {
      name: "ContentFilterError",
      data: { message: "The response was blocked by the provider's content filter" },
    } satisfies NonNullable<SessionV1.Assistant["error"]>
    const off = yield* events.listen((event) => {
      if (event.type !== Session.Event.Error.type) return Effect.void
      const data = event.data as typeof Session.Event.Error.data.Type
      if (data.sessionID === chat.id && data.error) errors.push(data.error)
      return Effect.void
    })

    yield* prompt.prompt({
      sessionID: chat.id,
      agent: "build",
      noReply: true,
      parts: [{ type: "text", text: "hello" }],
    })
    yield* llm.push(reply().text("partial response").contentFilter())

    const result = yield* prompt.loop({ sessionID: chat.id })
    const stored = yield* MessageV2.get({ sessionID: chat.id, messageID: result.info.id })
    yield* off

    expect(yield* llm.hits).toHaveLength(1)
    expect(result.info.role).toBe("assistant")
    expect(stored.info.role).toBe("assistant")
    if (result.info.role === "assistant" && stored.info.role === "assistant") {
      expect(result.info.finish).toBe("content-filter")
      expect(result.info.error).toEqual(expected)
      expect(stored.info.error).toEqual(result.info.error)
      expect(errors).toContainEqual(expected)
    }
    expect(result.parts).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: "text", text: "partial response" })]),
    )
  }),
)

it.instance("loop stops provider overflow instead of auto-compacting when disabled", () =>
  Effect.gen(function* () {
    const { llm } = yield* useServerConfig((url) => ({
      ...providerCfg(url),
      compaction: { auto: false },
    }))
    const prompt = yield* SessionPrompt.Service
    const sessions = yield* Session.Service
    const chat = yield* sessions.create({ title: "Pinned" })

    yield* llm.error(413, { error: { message: "request entity too large" } })
    yield* prompt.prompt({
      sessionID: chat.id,
      agent: "build",
      noReply: true,
      parts: [{ type: "text", text: "hello" }],
    })

    const result = yield* prompt.loop({ sessionID: chat.id })
    const messages = yield* sessions.messages({ sessionID: chat.id })

    expect(result.info.role).toBe("assistant")
    if (result.info.role === "assistant") {
      expect(result.info.error?.name).toBe("ContextOverflowError")
      expect(result.info.finish).toBe("error")
    }
    expect(messages.some((message) => message.parts.some((part) => part.type === "compaction"))).toBe(false)
  }),
)

noLLMServer.instance.skip(
  "prompt emits v2 prompted and synthetic events (v2 projector disabled)",
  () =>
    Effect.gen(function* () {
      const prompt = yield* SessionPrompt.Service
      const sessions = yield* Session.Service
      const chat = yield* sessions.create({ title: "Pinned" })

      yield* prompt.prompt({
        sessionID: chat.id,
        agent: "build",
        noReply: true,
        parts: [
          { type: "text", text: "hello v2" },
          {
            type: "file",
            mime: "text/plain",
            filename: "note.txt",
            url: "data:text/plain;base64,bm90ZSBjb250ZW50",
          },
        ],
      })

      const messages = yield* SessionV2.Service.use((session) => session.messages({ sessionID: chat.id })).pipe(
        Effect.provide(
          LayerNode.compile(SessionV2.node, [
            [SessionExecution.node, SessionExecution.noopLayer],
            [LocationServiceMap.node, locationServiceMapLayer],
          ]),
        ),
      )
      const { db } = yield* Database.Service
      const row = yield* db
        .select()
        .from(SessionMessageTable)
        .where(eq(SessionMessageTable.session_id, chat.id))
        .get()
        .pipe(Effect.orDie)
      expect(messages.find((message) => message.type === "user")).toMatchObject({ type: "user", text: "hello v2" })
      expect(typeof row?.data.time.created).toBe("number")
      expect(messages).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ type: "synthetic", text: expect.stringContaining("Called the Read tool") }),
          expect.objectContaining({ type: "synthetic", text: "note content" }),
        ]),
      )
    }),
  { config: cfg },
)

it.instance("static loop returns assistant text through local provider", () =>
  Effect.gen(function* () {
    const { llm } = yield* useServerConfig(providerCfg)
    const prompt = yield* SessionPrompt.Service
    const sessions = yield* Session.Service
    const session = yield* sessions.create({
      title: "Prompt provider",
      permission: [{ permission: "*", pattern: "*", action: "allow" }],
    })

    yield* prompt.prompt({
      sessionID: session.id,
      agent: "build",
      noReply: true,
      parts: [{ type: "text", text: "hello" }],
    })

    yield* llm.text("world")

    const result = yield* prompt.loop({ sessionID: session.id })
    expect(result.info.role).toBe("assistant")
    expect(result.parts.some((part) => part.type === "text" && part.text === "world")).toBe(true)
    expect(yield* llm.hits).toHaveLength(1)
    expect(yield* llm.pending).toBe(0)
  }),
)

it.instance("static loop consumes queued replies across turns", () =>
  Effect.gen(function* () {
    const { llm } = yield* useServerConfig(providerCfg)
    const prompt = yield* SessionPrompt.Service
    const sessions = yield* Session.Service
    const session = yield* sessions.create({
      title: "Prompt provider turns",
      permission: [{ permission: "*", pattern: "*", action: "allow" }],
    })

    yield* prompt.prompt({
      sessionID: session.id,
      agent: "build",
      noReply: true,
      parts: [{ type: "text", text: "hello one" }],
    })

    yield* llm.text("world one")

    const first = yield* prompt.loop({ sessionID: session.id })
    expect(first.info.role).toBe("assistant")
    expect(first.parts.some((part) => part.type === "text" && part.text === "world one")).toBe(true)

    yield* prompt.prompt({
      sessionID: session.id,
      agent: "build",
      noReply: true,
      parts: [{ type: "text", text: "hello two" }],
    })

    yield* llm.text("world two")

    const second = yield* prompt.loop({ sessionID: session.id })
    expect(second.info.role).toBe("assistant")
    expect(second.parts.some((part) => part.type === "text" && part.text === "world two")).toBe(true)

    expect(yield* llm.hits).toHaveLength(2)
    expect(yield* llm.pending).toBe(0)
  }),
)

it.instance("loop continues when finish is tool-calls", () =>
  Effect.gen(function* () {
    const { llm } = yield* useServerConfig(providerCfg)
    const prompt = yield* SessionPrompt.Service
    const sessions = yield* Session.Service
    const session = yield* sessions.create({
      title: "Pinned",
      permission: [{ permission: "*", pattern: "*", action: "allow" }],
    })
    yield* prompt.prompt({
      sessionID: session.id,
      agent: "build",
      noReply: true,
      parts: [{ type: "text", text: "hello" }],
    })
    yield* llm.tool("first", { value: "first" })
    yield* llm.text("second")

    const result = yield* prompt.loop({ sessionID: session.id })
    expect(yield* llm.calls).toBe(2)
    expect(result.info.role).toBe("assistant")
    if (result.info.role === "assistant") {
      expect(result.parts.some((part) => part.type === "text" && part.text === "second")).toBe(true)
      expect(result.info.finish).toBe("stop")
    }
  }),
)

it.instance("loop continues when finish is unknown", () =>
  Effect.gen(function* () {
    const { llm } = yield* useServerConfig(providerCfg)
    const prompt = yield* SessionPrompt.Service
    const sessions = yield* Session.Service
    const session = yield* sessions.create({
      title: "Pinned",
      permission: [{ permission: "*", pattern: "*", action: "allow" }],
    })
    yield* prompt.prompt({
      sessionID: session.id,
      agent: "build",
      noReply: true,
      parts: [{ type: "text", text: "hello" }],
    })
    yield* llm.push(reply())
    yield* llm.text("second")

    const result = yield* prompt.loop({ sessionID: session.id })
    expect(yield* llm.calls).toBe(2)
    expect(result.info.role).toBe("assistant")
    if (result.info.role === "assistant") {
      expect(result.parts.some((part) => part.type === "text" && part.text === "second")).toBe(true)
      expect(result.info.finish).toBe("stop")
    }
  }),
)

it.instance("glob tool keeps instance context during prompt runs", () =>
  Effect.gen(function* () {
    const { dir, llm } = yield* useServerConfig(providerCfg)
    const prompt = yield* SessionPrompt.Service
    const sessions = yield* Session.Service
    const session = yield* sessions.create({
      title: "Glob context",
      permission: [{ permission: "*", pattern: "*", action: "allow" }],
    })
    const file = path.join(dir, "probe.txt")
    yield* writeText(file, "probe")

    yield* prompt.prompt({
      sessionID: session.id,
      agent: "build",
      noReply: true,
      parts: [{ type: "text", text: "find text files" }],
    })
    yield* llm.tool("glob", { pattern: "**/*.txt" })
    yield* llm.text("done")

    const result = yield* prompt.loop({ sessionID: session.id })
    expect(result.info.role).toBe("assistant")

    const msgs = yield* MessageV2.filterCompactedEffect(session.id)
    const tool = msgs
      .flatMap((msg) => msg.parts)
      .find(
        (part): part is CompletedToolPart =>
          part.type === "tool" && part.tool === "glob" && part.state.status === "completed",
      )
    if (!tool) return

    expect(tool.state.output).toContain(file)
    expect(tool.state.output).not.toContain("No context found for instance")
    expect(result.parts.some((part) => part.type === "text" && part.text === "done")).toBe(true)
  }),
)

it.instance("loop continues when finish is stop but assistant has tool parts", () =>
  Effect.gen(function* () {
    const { llm } = yield* useServerConfig(providerCfg)
    const prompt = yield* SessionPrompt.Service
    const sessions = yield* Session.Service
    const session = yield* sessions.create({
      title: "Pinned",
      permission: [{ permission: "*", pattern: "*", action: "allow" }],
    })
    yield* prompt.prompt({
      sessionID: session.id,
      agent: "build",
      noReply: true,
      parts: [{ type: "text", text: "hello" }],
    })
    yield* llm.push(reply().tool("first", { value: "first" }).stop())
    yield* llm.text("second")

    const result = yield* prompt.loop({ sessionID: session.id })
    expect(yield* llm.calls).toBe(2)
    expect(result.info.role).toBe("assistant")
    if (result.info.role === "assistant") {
      expect(result.parts.some((part) => part.type === "text" && part.text === "second")).toBe(true)
      expect(result.info.finish).toBe("stop")
    }
  }),
)

it.instance("failed subtask preserves metadata on error tool state", () =>
  Effect.gen(function* () {
    const { llm } = yield* useServerConfig((url) => ({
      ...providerCfg(url),
      agent: {
        general: {
          model: "test/missing-model",
        },
      },
    }))
    const prompt = yield* SessionPrompt.Service
    const sessions = yield* Session.Service
    const chat = yield* sessions.create({ title: "Pinned" })
    yield* llm.tool("task", {
      description: "inspect bug",
      prompt: "look into the cache key path",
      subagent_type: "general",
    })
    yield* llm.text("done")
    const msg = yield* user(chat.id, "hello")
    yield* addSubtask(chat.id, msg.id)

    const result = yield* prompt.loop({ sessionID: chat.id })
    expect(result.info.role).toBe("assistant")
    expect(yield* llm.calls).toBe(2)

    const msgs = yield* MessageV2.filterCompactedEffect(chat.id)
    const taskMsg = msgs.find((item) => item.info.role === "assistant" && item.info.agent === "general")
    expect(taskMsg?.info.role).toBe("assistant")
    if (!taskMsg || taskMsg.info.role !== "assistant") return

    const tool = errorTool(taskMsg.parts)
    if (!tool) return

    expect(tool.state.error).toContain("Tool execution failed")
    expect(tool.state.metadata).toBeDefined()
    expect(tool.state.metadata?.sessionId).toBeDefined()
    expect(tool.state.metadata?.model).toEqual({
      providerID: ProviderV2.ID.make("test"),
      modelID: ModelV2.ID.make("missing-model"),
    })
  }),
)

it.instance("subtask child inherits parent session external_directory allow", () =>
  Effect.gen(function* () {
    const { llm } = yield* useServerConfig(providerCfg)
    const prompt = yield* SessionPrompt.Service
    const sessions = yield* Session.Service
    const chat = yield* sessions.create({
      title: "Parent",
      permission: [{ permission: "external_directory", pattern: "/tmp/allowed/*", action: "allow" }],
    })
    yield* llm.text("done")
    const msg = yield* user(chat.id, "hello")
    yield* addSubtask(chat.id, msg.id)

    yield* prompt.loop({ sessionID: chat.id })

    const kids = yield* sessions.children(chat.id)
    expect(kids).toHaveLength(1)
    const child = kids[0]!
    const rules = child.permission ?? []
    expect(rules).toEqual(
      expect.arrayContaining([{ permission: "external_directory", pattern: "/tmp/allowed/*", action: "allow" }]),
    )
    expect(Permission.evaluate("external_directory", "/tmp/allowed/file", rules).action).toBe("allow")
    expect(Permission.evaluate("task", "anything", rules).action).toBe("deny")
  }),
)

noLLMServer.instance("prompt tools replace previous prompt tool rules", () =>
  Effect.gen(function* () {
    const prompt = yield* SessionPrompt.Service
    const sessions = yield* Session.Service
    const session = yield* sessions.create({ title: "Prompt tools" })

    yield* prompt.prompt({
      sessionID: session.id,
      agent: "build",
      noReply: true,
      tools: { bash: false },
      parts: [{ type: "text", text: "first" }],
    })
    yield* prompt.prompt({
      sessionID: session.id,
      agent: "build",
      noReply: true,
      tools: { read: true },
      parts: [{ type: "text", text: "second" }],
    })

    const reloaded = yield* sessions.get(session.id)
    expect(reloaded.permission).toEqual([{ permission: "read", pattern: "*", action: "allow" }])
    expect(Permission.evaluate("bash", "anything", reloaded.permission ?? []).action).toBe("ask")
  }),
)

it.instance(
  "running subtask preserves metadata after tool-call transition",
  () =>
    Effect.gen(function* () {
      const { llm } = yield* useServerConfig(providerCfg)
      const prompt = yield* SessionPrompt.Service
      const sessions = yield* Session.Service
      const chat = yield* sessions.create({ title: "Pinned" })
      yield* llm.hang
      const msg = yield* user(chat.id, "hello")
      yield* addSubtask(chat.id, msg.id)

      const fiber = yield* prompt.loop({ sessionID: chat.id }).pipe(Effect.forkChild)

      const tool = yield* pollWithTimeout(
        Effect.gen(function* () {
          const msgs = yield* MessageV2.filterCompactedEffect(chat.id)
          const taskMsg = msgs.find((item) => item.info.role === "assistant" && item.info.agent === "general")
          const tool = taskMsg?.parts.find((part): part is SessionV1.ToolPart => part.type === "tool")
          if (tool?.state.status === "running" && tool.state.metadata?.sessionId) return tool
        }),
        "timed out waiting for running subtask metadata",
      )

      if (tool.state.status !== "running") return
      expect(typeof tool.state.metadata?.sessionId).toBe("string")
      expect(tool.state.title).toBeDefined()
      expect(tool.state.metadata?.model).toBeDefined()

      yield* prompt.cancel(chat.id)
      yield* Fiber.await(fiber)
    }),
  5_000,
)

it.instance(
  "running task tool preserves metadata after tool-call transition",
  () =>
    Effect.gen(function* () {
      const { llm } = yield* useServerConfig(providerCfg)
      const prompt = yield* SessionPrompt.Service
      const sessions = yield* Session.Service
      const chat = yield* sessions.create({
        title: "Pinned",
        permission: [{ permission: "*", pattern: "*", action: "allow" }],
      })
      yield* llm.tool("task", {
        description: "inspect bug",
        prompt: "look into the cache key path",
        subagent_type: "general",
      })
      yield* llm.hang
      yield* user(chat.id, "hello")

      const fiber = yield* prompt.loop({ sessionID: chat.id }).pipe(Effect.forkChild)

      const tool = yield* pollWithTimeout(
        Effect.gen(function* () {
          const msgs = yield* MessageV2.filterCompactedEffect(chat.id)
          const assistant = msgs.findLast((item) => item.info.role === "assistant" && item.info.agent === "build")
          const tool = assistant?.parts.find(
            (part): part is SessionV1.ToolPart => part.type === "tool" && part.tool === "task",
          )
          if (tool?.state.status === "running" && tool.state.metadata?.sessionId) return tool
        }),
        "timed out waiting for running task metadata",
      )

      if (tool.state.status !== "running") return
      expect(typeof tool.state.metadata?.sessionId).toBe("string")
      expect(tool.state.title).toBe("inspect bug")
      expect(tool.state.metadata?.model).toBeDefined()

      yield* prompt.cancel(chat.id)
      yield* Fiber.await(fiber)
    }),
  10_000,
)

it.instance(
  "loop sets status to busy then idle",
  () =>
    Effect.gen(function* () {
      const { llm } = yield* useServerConfig(providerCfg)
      const prompt = yield* SessionPrompt.Service
      const sessions = yield* Session.Service
      const status = yield* SessionStatus.Service

      yield* llm.hang

      const chat = yield* sessions.create({})
      yield* user(chat.id, "hi")

      const fiber = yield* prompt.loop({ sessionID: chat.id }).pipe(Effect.forkChild)
      yield* llm.wait(1)
      expect((yield* status.get(chat.id)).type).toBe("busy")
      yield* prompt.cancel(chat.id)
      yield* Fiber.await(fiber)
      expect((yield* status.get(chat.id)).type).toBe("idle")
    }),
  3_000,
)

// Cancel semantics

it.instance("cancel interrupts loop and resolves with an assistant message", () =>
  Effect.gen(function* () {
    const { llm } = yield* useServerConfig(providerCfg)
    const prompt = yield* SessionPrompt.Service
    const sessions = yield* Session.Service
    const chat = yield* sessions.create({ title: "Pinned" })
    yield* seed(chat.id)

    yield* llm.hang

    yield* user(chat.id, "more")

    const fiber = yield* prompt.loop({ sessionID: chat.id }).pipe(Effect.forkChild)
    yield* llm.wait(1)
    yield* waitForBusy(chat.id)
    yield* prompt.cancel(chat.id)
    const exit = yield* Fiber.await(fiber)
    expect(Exit.isSuccess(exit)).toBe(true)
    if (Exit.isSuccess(exit)) {
      expect(exit.value.info.role).toBe("assistant")
    }
  }),
)

it.instance("cancel records MessageAbortedError on interrupted process", () =>
  Effect.gen(function* () {
    const { llm } = yield* useServerConfig(providerCfg)
    const prompt = yield* SessionPrompt.Service
    const sessions = yield* Session.Service
    const chat = yield* sessions.create({ title: "Pinned" })
    yield* llm.hang
    yield* user(chat.id, "hello")

    const fiber = yield* prompt.loop({ sessionID: chat.id }).pipe(Effect.forkChild)
    yield* llm.wait(1)
    yield* waitForBusy(chat.id)
    yield* prompt.cancel(chat.id)
    const exit = yield* Fiber.await(fiber)
    expect(Exit.isSuccess(exit)).toBe(true)
    if (Exit.isSuccess(exit)) {
      const info = exit.value.info
      if (info.role === "assistant") {
        expect(info.error?.name).toBe("MessageAbortedError")
      }
    }
  }),
)

raceNoLLMServer.instance(
  "finalizes assistant when cancelled before processor creation completes",
  () =>
    Effect.gen(function* () {
      processorCreateStarted.length = 0
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          processorCreateStarted.length = 0
        }),
      )

      const prompt = yield* SessionPrompt.Service
      const sessions = yield* Session.Service
      const chat = yield* sessions.create({ title: "Processor creation race" })

      yield* prompt.prompt({
        sessionID: chat.id,
        agent: "build",
        noReply: true,
        parts: [{ type: "text", text: "first" }],
      })

      const firstCreate = defer<void>()
      processorCreateStarted.push(firstCreate.resolve)
      const first = yield* prompt.loop({ sessionID: chat.id }).pipe(Effect.forkChild)
      yield* Effect.promise(() => firstCreate.promise)

      yield* prompt.cancel(chat.id)
      const firstExit = yield* Fiber.await(first)
      expect(Exit.isSuccess(firstExit)).toBe(true)

      let messages = yield* sessions.messages({ sessionID: chat.id })
      const firstInterrupted = messages.at(-1)
      expect(firstInterrupted?.info.role).toBe("assistant")
      expect(firstInterrupted?.parts).toHaveLength(0)
      if (firstInterrupted?.info.role === "assistant") {
        expect(firstInterrupted.info.finish).toBeUndefined()
        expect(firstInterrupted.info.time.completed).toBeNumber()
        expect(firstInterrupted.info.error?.name).toBe("MessageAbortedError")
      }

      yield* prompt.prompt({
        sessionID: chat.id,
        agent: "build",
        noReply: true,
        parts: [{ type: "text", text: "second" }],
      })

      const secondCreate = defer<void>()
      processorCreateStarted.push(secondCreate.resolve)
      const second = yield* prompt.loop({ sessionID: chat.id }).pipe(Effect.forkChild)
      yield* Effect.promise(() => secondCreate.promise)

      yield* prompt.cancel(chat.id)
      const secondExit = yield* Fiber.await(second)
      expect(Exit.isSuccess(secondExit)).toBe(true)

      messages = yield* sessions.messages({ sessionID: chat.id })
      const poisonMessages = messages.filter(
        (message) =>
          message.info.role === "assistant" &&
          message.parts.length === 0 &&
          !message.info.finish &&
          !message.info.time.completed &&
          !message.info.error,
      )
      expect(poisonMessages).toHaveLength(0)

      const interruptedMessages = messages.filter(
        (message) =>
          message.info.role === "assistant" &&
          message.parts.length === 0 &&
          message.info.time.completed &&
          message.info.error?.name === "MessageAbortedError",
      )
      expect(interruptedMessages).toHaveLength(2)

      const lastUser = messages.at(-2)
      const lastAssistant = messages.at(-1)
      expect(lastUser?.info.role).toBe("user")
      expect(lastAssistant?.info.role).toBe("assistant")
      if (lastUser?.info.role === "user" && lastAssistant?.info.role === "assistant") {
        expect(lastAssistant.info.parentID).toBe(lastUser?.info.id)
      }
    }),
  { config: cfg },
  3_000,
)

noLLMServer.instance(
  "cancel finalizes subtask tool state",
  () =>
    Effect.gen(function* () {
      const ready = yield* Deferred.make<void>()
      const aborted = yield* Deferred.make<void>()
      const registry = yield* ToolRegistry.Service
      const { task } = yield* registry.named()
      const original = task.execute
      task.execute = (_args, ctx) =>
        Effect.callback<never>((_resume) => {
          ctx.abort.addEventListener("abort", () => succeedVoid(aborted), { once: true })
          if (ctx.abort.aborted) succeedVoid(aborted)
          succeedVoid(ready)
          return Effect.sync(() => succeedVoid(aborted))
        })
      yield* Effect.addFinalizer(() => Effect.sync(() => void (task.execute = original)))

      const { prompt, chat } = yield* boot()
      const msg = yield* user(chat.id, "hello")
      yield* addSubtask(chat.id, msg.id)

      const fiber = yield* prompt.loop({ sessionID: chat.id }).pipe(Effect.forkChild)
      yield* awaitWithTimeout(Deferred.await(ready), "timed out waiting for task tool to start", "10 seconds")
      yield* prompt.cancel(chat.id)

      const exit = yield* Fiber.await(fiber)
      expect(Exit.isSuccess(exit)).toBe(true)
      yield* awaitWithTimeout(Deferred.await(aborted), "timed out waiting for task tool abort", "10 seconds")

      const msgs = yield* MessageV2.filterCompactedEffect(chat.id)
      const taskMsg = msgs.find((item) => item.info.role === "assistant" && item.info.agent === "general")
      expect(taskMsg?.info.role).toBe("assistant")
      if (!taskMsg || taskMsg.info.role !== "assistant") return

      const tool = toolPart(taskMsg.parts)
      expect(tool?.type).toBe("tool")
      if (!tool) return

      expect(tool.state.status).not.toBe("running")
      expect(taskMsg.info.time.completed).toBeDefined()
      expect(taskMsg.info.finish).toBeDefined()
    }),
  { config: cfg },
  30_000,
)

it.instance(
  "cancel propagates from slash command subtask to child session",
  () =>
    Effect.gen(function* () {
      const { llm } = yield* useServerConfig(providerCfg)
      const prompt = yield* SessionPrompt.Service
      const sessions = yield* Session.Service
      const status = yield* SessionStatus.Service
      const chat = yield* sessions.create({ title: "Pinned" })
      yield* llm.hang
      const msg = yield* user(chat.id, "hello")
      yield* addSubtask(chat.id, msg.id)

      const fiber = yield* prompt.loop({ sessionID: chat.id }).pipe(Effect.forkChild)
      yield* llm.wait(1)

      const msgs = yield* MessageV2.filterCompactedEffect(chat.id)
      const taskMsg = msgs.find((item) => item.info.role === "assistant" && item.info.agent === "general")
      const tool = taskMsg ? toolPart(taskMsg.parts) : undefined
      const sessionID = tool?.state.status === "running" ? tool.state.metadata?.sessionId : undefined
      expect(typeof sessionID).toBe("string")
      if (typeof sessionID !== "string") throw new Error("missing child session id")
      const childID = SessionID.make(sessionID)
      expect((yield* status.get(childID)).type).toBe("busy")

      yield* prompt.cancel(chat.id)
      const exit = yield* Fiber.await(fiber)
      expect(Exit.isSuccess(exit)).toBe(true)

      expect((yield* status.get(chat.id)).type).toBe("idle")
      expect((yield* status.get(childID)).type).toBe("idle")
    }),
  10_000,
)

it.instance(
  "cancel with queued callers resolves all cleanly",
  () =>
    Effect.gen(function* () {
      const { llm } = yield* useServerConfig(providerCfg)
      const prompt = yield* SessionPrompt.Service
      const sessions = yield* Session.Service
      const chat = yield* sessions.create({ title: "Pinned" })
      yield* llm.hang
      yield* user(chat.id, "hello")

      const a = yield* prompt.loop({ sessionID: chat.id }).pipe(Effect.forkChild)
      yield* llm.wait(1)
      const b = yield* prompt.loop({ sessionID: chat.id }).pipe(Effect.forkChild)
      yield* Effect.sleep(50)

      yield* prompt.cancel(chat.id)
      const [exitA, exitB] = yield* Effect.all([Fiber.await(a), Fiber.await(b)])
      expect(Exit.isSuccess(exitA)).toBe(true)
      expect(Exit.isSuccess(exitB)).toBe(true)
      if (Exit.isSuccess(exitA) && Exit.isSuccess(exitB)) {
        expect(exitA.value.info.id).toBe(exitB.value.info.id)
      }
    }),
  { git: true },
  10_000,
)

// Queue semantics

noLLMServer.instance("concurrent loop callers get same result", () =>
  Effect.gen(function* () {
    const { prompt, run, chat } = yield* boot()
    yield* seed(chat.id, { finish: "stop" })

    const [a, b] = yield* Effect.all([prompt.loop({ sessionID: chat.id }), prompt.loop({ sessionID: chat.id })], {
      concurrency: "unbounded",
    })

    expect(a.info.id).toBe(b.info.id)
    expect(a.info.role).toBe("assistant")
    yield* run.assertNotBusy(chat.id)
  }),
)

it.instance("concurrent loop callers all receive same error result", () =>
  Effect.gen(function* () {
    const { llm } = yield* useServerConfig(providerCfg)
    const prompt = yield* SessionPrompt.Service
    const sessions = yield* Session.Service
    const chat = yield* sessions.create({ title: "Pinned" })

    yield* llm.fail("boom")
    yield* user(chat.id, "hello")

    const [a, b] = yield* Effect.all([prompt.loop({ sessionID: chat.id }), prompt.loop({ sessionID: chat.id })], {
      concurrency: "unbounded",
    })
    expect(a.info.id).toBe(b.info.id)
    expect(a.info.role).toBe("assistant")
  }),
)

it.instance("prompt submitted during an active run is included in the next LLM input", () =>
  Effect.gen(function* () {
    const { llm } = yield* useServerConfig(providerCfg)
    const gate = yield* Deferred.make<void>()
    const prompt = yield* SessionPrompt.Service
    const sessions = yield* Session.Service
    const chat = yield* sessions.create({ title: "Pinned" })

    yield* llm.hold("first", deferredAsPromise(gate))
    yield* llm.text("second")

    const a = yield* prompt
      .prompt({
        sessionID: chat.id,
        agent: "build",
        model: ref,
        parts: [{ type: "text", text: "first" }],
      })
      .pipe(Effect.forkChild)

    yield* llm.wait(1)
    yield* waitForBusy(chat.id)

    const id = MessageID.ascending()
    const b = yield* prompt
      .prompt({
        sessionID: chat.id,
        messageID: id,
        agent: "build",
        model: ref,
        parts: [{ type: "text", text: "second" }],
      })
      .pipe(Effect.forkChild)

    yield* pollWithTimeout(
      sessions
        .messages({ sessionID: chat.id })
        .pipe(
          Effect.map((msgs) => (msgs.some((msg) => msg.info.role === "user" && msg.info.id === id) ? true : undefined)),
        ),
      "timed out waiting for second prompt to save",
    )

    yield* Deferred.succeed(gate, void 0)

    const [ea, eb] = yield* Effect.all([Fiber.await(a), Fiber.await(b)])
    expect(Exit.isSuccess(ea)).toBe(true)
    expect(Exit.isSuccess(eb)).toBe(true)
    expect(yield* llm.calls).toBe(2)

    const msgs = yield* sessions.messages({ sessionID: chat.id })
    const assistants = msgs.filter((msg) => msg.info.role === "assistant")
    expect(assistants).toHaveLength(2)
    const last = assistants.at(-1)
    if (!last || last.info.role !== "assistant") throw new Error("expected second assistant")
    expect(last.info.parentID).toBe(id)
    expect(last.parts.some((part) => part.type === "text" && part.text === "second")).toBe(true)

    const inputs = yield* llm.inputs
    expect(inputs).toHaveLength(2)
    const messages = inputs.at(-1)?.messages
    if (!Array.isArray(messages)) throw new Error("expected LLM messages")
    expect(messages.at(-1)).toEqual({ role: "user", content: "second" })
  }),
)

it.instance("assertNotBusy fails with BusyError when loop running", () =>
  Effect.gen(function* () {
    const { llm } = yield* useServerConfig(providerCfg)
    const prompt = yield* SessionPrompt.Service
    const run = yield* SessionRunState.Service
    const sessions = yield* Session.Service
    yield* llm.hang

    const chat = yield* sessions.create({})
    yield* user(chat.id, "hi")

    const fiber = yield* prompt.loop({ sessionID: chat.id }).pipe(Effect.forkChild)
    yield* llm.wait(1)
    yield* waitForBusy(chat.id)

    const exit = yield* run.assertNotBusy(chat.id).pipe(Effect.exit)
    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isFailure(exit)) {
      expect(Cause.squash(exit.cause)).toBeInstanceOf(Session.BusyError)
      expect(Cause.squash(exit.cause)).toMatchObject({ _tag: "SessionBusyError", sessionID: chat.id })
    }

    yield* prompt.cancel(chat.id)
    yield* Fiber.await(fiber)
  }),
)

noLLMServer.instance("assertNotBusy succeeds when idle", () =>
  Effect.gen(function* () {
    const run = yield* SessionRunState.Service
    const sessions = yield* Session.Service

    const chat = yield* sessions.create({})
    const exit = yield* run.assertNotBusy(chat.id).pipe(Effect.exit)
    expect(Exit.isSuccess(exit)).toBe(true)
  }),
)

// Shell semantics

it.instance("shell rejects with BusyError when loop running", () =>
  Effect.gen(function* () {
    const { llm } = yield* useServerConfig(providerCfg)
    const prompt = yield* SessionPrompt.Service
    const sessions = yield* Session.Service
    const chat = yield* sessions.create({ title: "Pinned" })
    yield* llm.hang
    yield* user(chat.id, "hi")

    const fiber = yield* prompt.loop({ sessionID: chat.id }).pipe(Effect.forkChild)
    yield* llm.wait(1)
    yield* waitForBusy(chat.id)

    const exit = yield* prompt.shell({ sessionID: chat.id, agent: "build", command: "echo hi" }).pipe(Effect.exit)
    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isFailure(exit)) {
      expect(Cause.squash(exit.cause)).toBeInstanceOf(Session.BusyError)
      expect(Cause.squash(exit.cause)).toMatchObject({ _tag: "SessionBusyError", sessionID: chat.id })
    }

    yield* prompt.cancel(chat.id)
    yield* Fiber.await(fiber)
  }),
)

unixNoLLMServer(
  "shell captures stdout and stderr in completed tool output",
  () =>
    Effect.gen(function* () {
      const { prompt, run, chat } = yield* boot()
      const result = yield* prompt.shell({
        sessionID: chat.id,
        agent: "build",
        command: "printf out && printf err >&2",
      })

      expect(result.info.role).toBe("assistant")
      const tool = completedTool(result.parts)
      if (!tool) return

      expect(tool.state.output).toContain("out")
      expect(tool.state.output).toContain("err")
      expect(tool.state.metadata.output).toContain("out")
      expect(tool.state.metadata.output).toContain("err")
      yield* run.assertNotBusy(chat.id)
    }),
  { config: cfg },
)

unixNoLLMServer(
  "shell completes a fast command on the preferred shell",
  () =>
    Effect.gen(function* () {
      const { directory: dir } = yield* TestInstance
      const { prompt, run, chat } = yield* boot()
      const result = yield* prompt.shell({
        sessionID: chat.id,
        agent: "build",
        command: "pwd",
      })

      expect(result.info.role).toBe("assistant")
      const tool = completedTool(result.parts)
      if (!tool) return

      expect(tool.state.input.command).toBe("pwd")
      expect(tool.state.output).toContain(dir)
      expect(tool.state.metadata.output).toContain(dir)
      yield* run.assertNotBusy(chat.id)
    }),
  { config: cfg },
)

unixNoLLMServer(
  "shell uses configured shell over env shell",
  () =>
    withSh(() =>
      Effect.gen(function* () {
        if (!(yield* hasBash)) return

        const { prompt, chat } = yield* boot()
        const result = yield* prompt.shell({
          sessionID: chat.id,
          agent: "build",
          command: "[[ 1 -eq 1 ]] && printf configured",
        })

        const tool = completedTool(result.parts)
        if (!tool) return
        expect(tool.state.output).toContain("configured")
      }),
    ),
  { config: { ...cfg, shell: "bash" } },
  30_000,
)

unixNoLLMServer(
  "shell commands can change directory after startup",
  () =>
    withSh(() =>
      Effect.gen(function* () {
        const { directory: dir } = yield* TestInstance
        const { prompt, run, chat } = yield* boot()
        const parent = path.dirname(dir)
        const result = yield* prompt.shell({
          sessionID: chat.id,
          agent: "build",
          command: "cd .. && pwd",
        })

        expect(result.info.role).toBe("assistant")
        const tool = completedTool(result.parts)
        if (!tool) return

        expect(tool.state.output).toContain(parent)
        expect(tool.state.metadata.output).toContain(parent)
        yield* run.assertNotBusy(chat.id)
      }),
    ),
  { config: cfg },
)

unixNoLLMServer(
  "shell lists files from the project directory",
  () =>
    Effect.gen(function* () {
      const { directory: dir } = yield* TestInstance
      const { prompt, run, chat } = yield* boot()
      yield* writeText(path.join(dir, "README.md"), "# e2e\n")

      const result = yield* prompt.shell({
        sessionID: chat.id,
        agent: "build",
        command: "command ls",
      })

      expect(result.info.role).toBe("assistant")
      const tool = completedTool(result.parts)
      if (!tool) return

      expect(tool.state.input.command).toBe("command ls")
      expect(tool.state.output).toContain("README.md")
      expect(tool.state.metadata.output).toContain("README.md")
      yield* run.assertNotBusy(chat.id)
    }),
  { config: cfg },
)

unixNoLLMServer(
  "shell captures stderr from a failing command",
  () =>
    Effect.gen(function* () {
      const { prompt, run, chat } = yield* boot()
      const result = yield* prompt.shell({
        sessionID: chat.id,
        agent: "build",
        command: "command -v __nonexistent_cmd_e2e__ || echo 'not found' >&2; exit 1",
      })

      expect(result.info.role).toBe("assistant")
      const tool = completedTool(result.parts)
      if (!tool) return

      expect(tool.state.output).toContain("not found")
      expect(tool.state.metadata.output).toContain("not found")
      yield* run.assertNotBusy(chat.id)
    }),
  { config: cfg },
)

unixNoLLMServer(
  "shell updates running metadata before process exit",
  () =>
    withSh(() =>
      Effect.gen(function* () {
        const { prompt, chat } = yield* boot()

        const fiber = yield* prompt
          .shell({ sessionID: chat.id, agent: "build", command: "printf first && sleep 0.2 && printf second" })
          .pipe(Effect.forkChild)

        yield* pollWithTimeout(
          Effect.gen(function* () {
            const msgs = yield* MessageV2.filterCompactedEffect(chat.id)
            const taskMsg = msgs.find((item) => item.info.role === "assistant")
            const tool = taskMsg ? toolPart(taskMsg.parts) : undefined
            if (tool?.state.status === "running" && tool.state.metadata?.output.includes("first")) return true
          }),
          "timed out waiting for running shell metadata",
        )

        const exit = yield* Fiber.await(fiber)
        expect(Exit.isSuccess(exit)).toBe(true)
      }),
    ),
  { config: cfg },
  30_000,
)

it.instance(
  "loop waits while shell runs and starts after shell exits",
  () =>
    Effect.gen(function* () {
      const { llm } = yield* useServerConfig(providerCfg)
      const prompt = yield* SessionPrompt.Service
      const sessions = yield* Session.Service
      const chat = yield* sessions.create({
        title: "Pinned",
        permission: [{ permission: "*", pattern: "*", action: "allow" }],
      })
      yield* llm.text("after-shell")

      const sh = yield* prompt
        .shell({ sessionID: chat.id, agent: "build", command: "sleep 0.2" })
        .pipe(Effect.forkChild)
      yield* waitForBusy(chat.id)

      const loop = yield* prompt.loop({ sessionID: chat.id }).pipe(Effect.forkChild)
      yield* Effect.sleep(50)

      expect(yield* llm.calls).toBe(0)

      yield* Fiber.await(sh)
      const exit = yield* Fiber.await(loop)

      expect(Exit.isSuccess(exit)).toBe(true)
      if (Exit.isSuccess(exit)) {
        expect(exit.value.info.role).toBe("assistant")
        expect(exit.value.parts.some((part) => part.type === "text" && part.text === "after-shell")).toBe(true)
      }
      expect(yield* llm.calls).toBe(1)
    }),
  { git: true },
  10_000,
)

it.instance(
  "shell completion resumes queued loop callers",
  () =>
    Effect.gen(function* () {
      const { llm } = yield* useServerConfig(providerCfg)
      const prompt = yield* SessionPrompt.Service
      const sessions = yield* Session.Service
      const chat = yield* sessions.create({
        title: "Pinned",
        permission: [{ permission: "*", pattern: "*", action: "allow" }],
      })
      yield* llm.text("done")

      const sh = yield* prompt
        .shell({ sessionID: chat.id, agent: "build", command: "sleep 0.2" })
        .pipe(Effect.forkChild)
      yield* waitForBusy(chat.id)

      const a = yield* prompt.loop({ sessionID: chat.id }).pipe(Effect.forkChild)
      const b = yield* prompt.loop({ sessionID: chat.id }).pipe(Effect.forkChild)
      yield* Effect.sleep(50)

      expect(yield* llm.calls).toBe(0)

      yield* Fiber.await(sh)
      const [ea, eb] = yield* Effect.all([Fiber.await(a), Fiber.await(b)])

      expect(Exit.isSuccess(ea)).toBe(true)
      expect(Exit.isSuccess(eb)).toBe(true)
      if (Exit.isSuccess(ea) && Exit.isSuccess(eb)) {
        expect(ea.value.info.id).toBe(eb.value.info.id)
        expect(ea.value.info.role).toBe("assistant")
      }
      expect(yield* llm.calls).toBe(1)
    }),
  { git: true },
  10_000,
)

unix(
  "command ! expansion uses configured shell over env shell",
  () =>
    withSh(() =>
      Effect.gen(function* () {
        if (!(yield* hasBash)) return
        const { llm } = yield* useServerConfig((url) => ({
          ...providerCfg(url),
          shell: "bash",
          command: {
            probe: {
              template: "Probe: !`[[ 1 -eq 1 ]] && printf configured`",
            },
          },
        }))

        const { prompt, chat } = yield* boot()
        yield* llm.text("done")

        const result = yield* prompt.command({
          sessionID: chat.id,
          command: "probe",
          arguments: "",
        })

        expect(result.info.role).toBe("assistant")
        const inputs = yield* llm.inputs
        expect(JSON.stringify(inputs.at(-1)?.messages)).toContain("configured")
      }),
    ),
  30_000,
)

unixNoLLMServer(
  "cancel interrupts shell and resolves cleanly",
  () =>
    withSh(() =>
      Effect.gen(function* () {
        const { prompt, run, chat } = yield* boot()
        const { directory: dir } = yield* TestInstance
        const afs = yield* FSUtil.Service
        const ready = path.join(dir, ".shell-ready")

        const sh = yield* prompt
          .shell({ sessionID: chat.id, agent: "build", command: ": > '.shell-ready'; sleep 30" })
          .pipe(Effect.forkChild)
        yield* pollWithTimeout(
          afs.existsSafe(ready).pipe(Effect.map((exists) => (exists ? (true as const) : undefined))),
          "shell never created readiness marker",
        )

        yield* prompt.cancel(chat.id)

        const status = yield* SessionStatus.Service
        expect((yield* status.get(chat.id)).type).toBe("idle")
        const busy = yield* run.assertNotBusy(chat.id).pipe(Effect.exit)
        expect(Exit.isSuccess(busy)).toBe(true)

        const exit = yield* Fiber.await(sh)
        expect(Exit.isSuccess(exit)).toBe(true)
        if (Exit.isSuccess(exit)) {
          expect(exit.value.info.role).toBe("assistant")
          const tool = completedTool(exit.value.parts)
          if (tool) {
            expect(tool.state.output).toContain("User aborted the command")
          }
        }
      }),
    ),
  { git: true, config: cfg },
  30_000,
)

unixNoLLMServer(
  "cancel persists aborted shell result when shell ignores TERM",
  () =>
    withSh(() =>
      Effect.gen(function* () {
        const { prompt, chat } = yield* boot()
        const { directory: dir } = yield* TestInstance
        const afs = yield* FSUtil.Service
        const ready = path.join(dir, ".trap-ready")

        const sh = yield* prompt
          .shell({
            sessionID: chat.id,
            agent: "build",
            // Touch marker AFTER trap installs so the test waits for the actual
            // ignore-TERM state before cancelling; otherwise SIGTERM can arrive
            // before `trap` runs and the escalation path is never exercised.
            command: `trap '' TERM; touch "${ready}"; sleep 30`,
          })
          .pipe(Effect.forkChild)

        yield* Effect.gen(function* () {
          while (!(yield* afs.existsSafe(ready))) {
            yield* Effect.sleep(Duration.millis(10))
          }
        }).pipe(Effect.timeout(Duration.seconds(5)))

        yield* prompt.cancel(chat.id)

        const exit = yield* Fiber.await(sh)
        expect(Exit.isSuccess(exit)).toBe(true)
        if (Exit.isSuccess(exit)) {
          expect(exit.value.info.role).toBe("assistant")
          const tool = completedTool(exit.value.parts)
          if (tool) {
            expect(tool.state.output).toContain("User aborted the command")
          }
        }
      }),
    ),
  { git: true, config: cfg },
  30_000,
)

unix(
  "cancel finalizes interrupted bash tool output through normal truncation",
  () =>
    Effect.gen(function* () {
      const { dir, llm } = yield* useServerConfig(providerCfg)
      const prompt = yield* SessionPrompt.Service
      const sessions = yield* Session.Service
      const chat = yield* sessions.create({
        title: "Interrupted bash truncation",
        permission: [{ permission: "*", pattern: "*", action: "allow" }],
      })

      yield* prompt.prompt({
        sessionID: chat.id,
        agent: "build",
        noReply: true,
        parts: [{ type: "text", text: "run bash" }],
      })

      yield* llm.tool("bash", {
        command:
          'i=0; while [ "$i" -lt 4000 ]; do printf "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx %05d\\n" "$i"; i=$((i + 1)); done; printf truncation-ready; sleep 30',
        timeout: 30_000,
        workdir: path.resolve(dir),
      })

      const run = yield* prompt.loop({ sessionID: chat.id }).pipe(Effect.forkChild)
      yield* llm.wait(1)
      yield* pollWithTimeout(
        Effect.gen(function* () {
          const msgs = yield* MessageV2.filterCompactedEffect(chat.id)
          const assistant = msgs.findLast((item) => item.info.role === "assistant")
          const tool = assistant ? toolPart(assistant.parts) : undefined
          if (tool?.state.status === "running" && tool.state.metadata?.output.includes("truncation-ready")) return true
        }),
        "timed out waiting for truncated shell output",
      )
      yield* prompt.cancel(chat.id)

      const exit = yield* Fiber.await(run)
      expect(Exit.isSuccess(exit)).toBe(true)
      if (Exit.isFailure(exit)) return

      const tool = completedTool(exit.value.parts)
      if (!tool) return

      expect(tool.state.metadata.truncated).toBe(true)
      expect(typeof tool.state.metadata.outputPath).toBe("string")
      expect(tool.state.output).toMatch(/\.\.\.output truncated\.\.\./)
      expect(tool.state.output).toMatch(/Full output saved to:\s+\S+/)
      expect(tool.state.output).not.toContain("Tool execution aborted")
    }),
  { git: true },
  30_000,
)

unixNoLLMServer(
  "cancel interrupts loop queued behind shell",
  () =>
    Effect.gen(function* () {
      const { prompt, chat } = yield* boot()

      const sh = yield* prompt.shell({ sessionID: chat.id, agent: "build", command: "sleep 30" }).pipe(Effect.forkChild)
      yield* waitForBusy(chat.id)

      const loop = yield* prompt.loop({ sessionID: chat.id }).pipe(Effect.forkChild)
      yield* Effect.sleep(50)

      yield* prompt.cancel(chat.id)

      const exit = yield* Fiber.await(loop)
      expect(Exit.isSuccess(exit)).toBe(true)
      if (Exit.isSuccess(exit)) {
        const tool = completedTool(exit.value.parts)
        expect(tool?.state.output).toContain("User aborted the command")
      }

      yield* Fiber.await(sh)
    }),
  { git: true, config: cfg },
  30_000,
)

unixNoLLMServer(
  "shell rejects when another shell is already running",
  () =>
    withSh(() =>
      Effect.gen(function* () {
        const { prompt, chat } = yield* boot()

        const a = yield* prompt
          .shell({ sessionID: chat.id, agent: "build", command: "sleep 30" })
          .pipe(Effect.forkChild)
        yield* waitForBusy(chat.id)

        const exit = yield* prompt.shell({ sessionID: chat.id, agent: "build", command: "echo hi" }).pipe(Effect.exit)
        expect(Exit.isFailure(exit)).toBe(true)
        if (Exit.isFailure(exit)) {
          expect(Cause.squash(exit.cause)).toBeInstanceOf(Session.BusyError)
        }

        yield* prompt.cancel(chat.id)
        yield* Fiber.await(a)
      }),
    ),
  { git: true, config: cfg },
  30_000,
)

// Abort signal propagation tests for inline tool execution

function hangUntilAborted(tool: { execute: (...args: any[]) => any }) {
  return Effect.gen(function* () {
    const ready = yield* Deferred.make<void>()
    const aborted = yield* Deferred.make<void>()
    const original = tool.execute
    tool.execute = (_args: any, ctx: any) => {
      ctx.abort.addEventListener("abort", () => succeedVoid(aborted), { once: true })
      if (ctx.abort.aborted) succeedVoid(aborted)
      succeedVoid(ready)
      return Effect.callback<never>(() => Effect.sync(() => succeedVoid(aborted)))
    }
    const restore = Effect.addFinalizer(() => Effect.sync(() => void (tool.execute = original)))
    return { ready, aborted, restore }
  })
}

noLLMServer.instance(
  "interrupt propagates abort signal to read tool via file part (text/plain)",
  () =>
    Effect.gen(function* () {
      const { directory: dir } = yield* TestInstance
      const registry = yield* ToolRegistry.Service
      const { read } = yield* registry.named()
      const { ready, restore } = yield* hangUntilAborted(read)
      yield* restore

      const prompt = yield* SessionPrompt.Service
      const sessions = yield* Session.Service
      const chat = yield* sessions.create({ title: "Abort Test" })

      const testFile = path.join(dir, "test.txt")
      yield* writeText(testFile, "hello world")

      const fiber = yield* prompt
        .prompt({
          sessionID: chat.id,
          agent: "build",
          parts: [
            { type: "text", text: "read this" },
            { type: "file", url: `file://${testFile}`, filename: "test.txt", mime: "text/plain" },
          ],
        })
        .pipe(Effect.forkChild)

      yield* awaitWithTimeout(Deferred.await(ready), "timed out waiting for read tool to start", "10 seconds")
      yield* prompt.cancel(chat.id)
      yield* Fiber.interrupt(fiber)
      const exit = yield* Fiber.await(fiber)
      expect(Exit.isFailure(exit)).toBe(true)
    }),
  { config: cfg },
  30_000,
)

noLLMServer.instance(
  "interrupt propagates abort signal to read tool via file part (directory)",
  () =>
    Effect.gen(function* () {
      const { directory: dir } = yield* TestInstance
      const registry = yield* ToolRegistry.Service
      const { read } = yield* registry.named()
      const { ready, restore } = yield* hangUntilAborted(read)
      yield* restore

      const prompt = yield* SessionPrompt.Service
      const sessions = yield* Session.Service
      const chat = yield* sessions.create({ title: "Abort Test" })

      const fiber = yield* prompt
        .prompt({
          sessionID: chat.id,
          agent: "build",
          parts: [
            { type: "text", text: "read this" },
            { type: "file", url: `file://${dir}`, filename: "dir", mime: "application/x-directory" },
          ],
        })
        .pipe(Effect.forkChild)

      yield* awaitWithTimeout(Deferred.await(ready), "timed out waiting for read tool to start", "10 seconds")
      yield* prompt.cancel(chat.id)
      yield* Fiber.interrupt(fiber)
      const exit = yield* Fiber.await(fiber)
      expect(Exit.isFailure(exit)).toBe(true)
    }),
  { config: cfg },
  30_000,
)

// Missing file handling

noLLMServer.instance(
  "does not fail the prompt when a file part is missing",
  () =>
    Effect.gen(function* () {
      const { directory: dir } = yield* TestInstance
      const prompt = yield* SessionPrompt.Service
      const sessions = yield* Session.Service
      const session = yield* sessions.create({})

      const missing = path.join(dir, "does-not-exist.ts")
      const msg = yield* prompt.prompt({
        sessionID: session.id,
        agent: "build",
        noReply: true,
        parts: [
          { type: "text", text: "please review @does-not-exist.ts" },
          {
            type: "file",
            mime: "text/plain",
            url: `file://${missing}`,
            filename: "does-not-exist.ts",
          },
        ],
      })

      if (msg.info.role !== "user") throw new Error("expected user message")
      const hasFailure = msg.parts.some(
        (part) => part.type === "text" && part.synthetic && part.text.includes("Read tool failed to read"),
      )
      expect(hasFailure).toBe(true)

      yield* sessions.remove(session.id)
    }),
  { config: cfg },
)

noLLMServer.instance(
  "keeps stored part order stable when file resolution is async",
  () =>
    Effect.gen(function* () {
      const { directory: dir } = yield* TestInstance
      const prompt = yield* SessionPrompt.Service
      const sessions = yield* Session.Service
      const session = yield* sessions.create({})

      const missing = path.join(dir, "still-missing.ts")
      const msg = yield* prompt.prompt({
        sessionID: session.id,
        agent: "build",
        noReply: true,
        parts: [
          {
            type: "file",
            mime: "text/plain",
            url: `file://${missing}`,
            filename: "still-missing.ts",
          },
          { type: "text", text: "after-file" },
        ],
      })

      if (msg.info.role !== "user") throw new Error("expected user message")

      const stored = yield* MessageV2.get({
        sessionID: session.id,
        messageID: msg.info.id,
      })
      const text = stored.parts.filter((part) => part.type === "text").map((part) => part.text)

      expect(text[0]?.startsWith("Called the Read tool with the following input:")).toBe(true)
      expect(text[1]?.includes("Read tool failed to read")).toBe(true)
      expect(text[2]).toBe("after-file")

      yield* sessions.remove(session.id)
    }),
  { config: cfg },
)

// Special characters in filenames

noLLMServer.instance(
  "handles filenames with # character",
  () =>
    Effect.gen(function* () {
      const { directory: dir } = yield* TestInstance
      yield* writeText(path.join(dir, "file#name.txt"), "special content\n")

      const prompt = yield* SessionPrompt.Service
      const sessions = yield* Session.Service
      const session = yield* sessions.create({})
      const parts = yield* prompt.resolvePromptParts("Read @file#name.txt")
      const fileParts = parts.filter((part) => part.type === "file")

      expect(fileParts.length).toBe(1)
      expect(fileParts[0].filename).toBe("file#name.txt")
      expect(fileParts[0].url).toContain("%23")

      const decodedPath = fileURLToPath(fileParts[0].url)
      expect(decodedPath).toBe(path.join(dir, "file#name.txt"))

      const message = yield* prompt.prompt({
        sessionID: session.id,
        parts,
        noReply: true,
      })
      const stored = yield* MessageV2.get({ sessionID: session.id, messageID: message.info.id })
      const textParts = stored.parts.filter((part) => part.type === "text")
      const hasContent = textParts.some((part) => part.text.includes("special content"))
      expect(hasContent).toBe(true)

      yield* sessions.remove(session.id)
    }),
  { git: true, config: cfg },
)

// Regression: empty assistant turn loop

it.instance("does not loop empty assistant turns for a simple reply", () =>
  Effect.gen(function* () {
    const { llm } = yield* useServerConfig(providerCfg)
    const prompt = yield* SessionPrompt.Service
    const sessions = yield* Session.Service
    const session = yield* sessions.create({ title: "Prompt regression" })

    yield* llm.text("packages/opencode/src/session/processor.ts")

    const result = yield* prompt.prompt({
      sessionID: session.id,
      agent: "build",
      parts: [{ type: "text", text: "Where is SessionProcessor?" }],
    })

    expect(result.info.role).toBe("assistant")
    expect(result.parts.some((part) => part.type === "text" && part.text.includes("processor.ts"))).toBe(true)

    const msgs = yield* sessions.messages({ sessionID: session.id })
    expect(msgs.filter((msg) => msg.info.role === "assistant")).toHaveLength(1)
    expect(yield* llm.calls).toBe(1)
  }),
)

it.instance("records aborted errors when prompt is cancelled mid-stream", () =>
  Effect.gen(function* () {
    const { llm } = yield* useServerConfig(providerCfg)
    const prompt = yield* SessionPrompt.Service
    const sessions = yield* Session.Service
    const session = yield* sessions.create({ title: "Prompt cancel regression" })

    yield* llm.hang

    const fiber = yield* prompt
      .prompt({
        sessionID: session.id,
        agent: "build",
        parts: [{ type: "text", text: "Cancel me" }],
      })
      .pipe(Effect.forkChild)

    yield* llm.wait(1)
    yield* waitForBusy(session.id)
    yield* prompt.cancel(session.id)

    const exit = yield* Fiber.await(fiber)
    expect(Exit.isSuccess(exit)).toBe(true)
    if (Exit.isSuccess(exit)) {
      expect(exit.value.info.role).toBe("assistant")
      if (exit.value.info.role === "assistant") {
        expect(exit.value.info.error?.name).toBe("MessageAbortedError")
      }
    }

    const msgs = yield* sessions.messages({ sessionID: session.id })
    const last = msgs.findLast((msg) => msg.info.role === "assistant")
    expect(last?.info.role).toBe("assistant")
    if (last?.info.role === "assistant") {
      expect(last.info.error?.name).toBe("MessageAbortedError")
    }
  }),
)

// Agent variant

noLLMServer.instance(
  "applies agent variant only when using agent model",
  () =>
    Effect.gen(function* () {
      const prompt = yield* SessionPrompt.Service
      const sessions = yield* Session.Service
      const session = yield* sessions.create({})

      const other = yield* prompt.prompt({
        sessionID: session.id,
        agent: "build",
        model: { providerID: ProviderV2.ID.make("opencode"), modelID: ModelV2.ID.make("kimi-k2.5-free") },
        noReply: true,
        parts: [{ type: "text", text: "hello" }],
      })
      if (other.info.role !== "user") throw new Error("expected user message")
      expect(other.info.model.variant).toBeUndefined()

      const match = yield* prompt.prompt({
        sessionID: session.id,
        agent: "build",
        noReply: true,
        parts: [{ type: "text", text: "hello again" }],
      })
      if (match.info.role !== "user") throw new Error("expected user message")
      expect(match.info.model).toEqual({
        providerID: ProviderV2.ID.make("test"),
        modelID: ModelV2.ID.make("test-model"),
        variant: "xhigh",
      })
      expect(match.info.model.variant).toBe("xhigh")

      const override = yield* prompt.prompt({
        sessionID: session.id,
        agent: "build",
        noReply: true,
        variant: "high",
        parts: [{ type: "text", text: "hello third" }],
      })
      if (override.info.role !== "user") throw new Error("expected user message")
      expect(override.info.model.variant).toBe("high")

      yield* sessions.remove(session.id)
    }),
  {
    config: {
      ...cfg,
      provider: {
        ...cfg.provider,
        test: {
          ...cfg.provider.test,
          models: {
            "test-model": {
              ...cfg.provider.test.models["test-model"],
              variants: { xhigh: {}, high: {} },
            },
          },
        },
      },
      agent: {
        build: {
          model: "test/test-model",
          variant: "xhigh",
        },
      },
    },
  },
)

// Agent / command resolution errors

noLLMServer.instance(
  "unknown agent throws typed error",
  () =>
    Effect.gen(function* () {
      const prompt = yield* SessionPrompt.Service
      const sessions = yield* Session.Service
      const session = yield* sessions.create({})
      const exit = yield* prompt
        .prompt({
          sessionID: session.id,
          agent: "nonexistent-agent-xyz",
          noReply: true,
          parts: [{ type: "text", text: "hello" }],
        })
        .pipe(Effect.exit)

      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        const err = Cause.squash(exit.cause)
        expect(err).not.toBeInstanceOf(TypeError)
        expect(NamedError.Unknown.isInstance(err)).toBe(true)
        if (NamedError.Unknown.isInstance(err)) {
          expect(err.data.message).toContain('Agent not found: "nonexistent-agent-xyz"')
        }
      }
    }),
  30_000,
)

noLLMServer.instance(
  "unknown agent error includes available agent names",
  () =>
    Effect.gen(function* () {
      const prompt = yield* SessionPrompt.Service
      const sessions = yield* Session.Service
      const session = yield* sessions.create({})
      const exit = yield* prompt
        .prompt({
          sessionID: session.id,
          agent: "nonexistent-agent-xyz",
          noReply: true,
          parts: [{ type: "text", text: "hello" }],
        })
        .pipe(Effect.exit)

      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        const err = Cause.squash(exit.cause)
        expect(NamedError.Unknown.isInstance(err)).toBe(true)
        if (NamedError.Unknown.isInstance(err)) {
          expect(err.data.message).toContain("build")
        }
      }
    }),
  30_000,
)

noLLMServer.instance(
  "unknown command throws typed error with available names",
  () =>
    Effect.gen(function* () {
      const prompt = yield* SessionPrompt.Service
      const sessions = yield* Session.Service
      const session = yield* sessions.create({})
      const exit = yield* prompt
        .command({
          sessionID: session.id,
          command: "nonexistent-command-xyz",
          arguments: "",
        })
        .pipe(Effect.exit)

      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        const err = Cause.squash(exit.cause)
        expect(err).not.toBeInstanceOf(TypeError)
        expect(NamedError.Unknown.isInstance(err)).toBe(true)
        if (NamedError.Unknown.isInstance(err)) {
          expect(err.data.message).toContain('Command not found: "nonexistent-command-xyz"')
          expect(err.data.message).toContain("init")
        }
      }
    }),
  30_000,
)
