import { describe, expect } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { AIError, LanguageModel, LLMEvent, TransportError } from "@opencode/ai/effect"
import { OpenAIChat } from "@opencode/ai/protocols/openai-chat"
import { TestLLM } from "@opencode/ai/testing"
import { Agent } from "@opencode/core/agent"
import { Bus } from "@opencode/core/bus"
import { Config } from "@opencode/core/config"
import { Database } from "@opencode/core/database/database"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { FileAccess } from "@opencode/core/file-access"
import type { FileSystem } from "@opencode/core/filesystem"
import { Image } from "@opencode/core/image"
import { Instance } from "@opencode/core/instance/service"
import { Job } from "@opencode/core/job"
import { Location } from "@opencode/core/location"
import { LocationServiceMap } from "@opencode/core/location-service-map"
import type { LocationServices } from "@opencode/core/location-services"
import { Permission } from "@opencode/core/permission"
import { Project } from "@opencode/core/project"
import { Session } from "@opencode/core/session"
import { SessionEvent } from "@opencode/core/session/event"
import { SessionExecution } from "@opencode/core/session/execution"
import { StepFailedError } from "@opencode/core/session/error"
import { SessionInstructions } from "@opencode/core/session/instructions"
import { SessionMessage } from "@opencode/core/session/message"
import { SessionModelRequest } from "@opencode/core/session/model-request"
import { SessionProjector } from "@opencode/core/session/projector"
import { createLLMEventPublisher } from "@opencode/core/session/runner/publish-llm-event"
import { SessionRunnerModel } from "@opencode/core/session/runner/model"
import { SessionRunner } from "@opencode/core/session/runner/index"
import { SessionStep } from "@opencode/core/session/runner/step"
import { SessionStore } from "@opencode/core/session/store"
import { toSessionError } from "@opencode/core/session/to-session-error"
import { Tool } from "@opencode/core/tool"
import { ToolOutput } from "@opencode/core/tool-output"
import { Snapshot } from "@opencode/core/snapshot"
import { ReadTool } from "@opencode/core/tool/plugin/read"
import { ReadToolFileSystem } from "@opencode/core/tool/read-filesystem"
import { Provider } from "@opencode/schema/provider"
import { Model } from "@opencode/schema/model"
import { FSUtil } from "@opencode/util/fs-util"
import { makeLocationNode } from "@opencode/util/effect/app-node"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Cause, Context, Deferred, Effect, Exit, Fiber, Layer, LayerMap, Scope } from "effect"
import { tempLocationLayer } from "./fixture/location"
import { testEffect } from "./lib/effect"
import { globalProjectNode } from "./lib/project"
import { registerToolPlugin } from "./lib/tool"

const readToolNode = makeLocationNode({
  name: "test/read-range-tool",
  layer: Layer.effectDiscard(registerToolPlugin(ReadTool.Plugin)),
  deps: [
    Tool.node,
    SessionStore.node,
    ReadToolFileSystem.node,
    FileAccess.node,
    Permission.node,
    SessionInstructions.node,
    FSUtil.node,
    Location.node,
  ],
})
const config = Config.testLayer()
const it = testEffect(
  Layer.merge(
    AppNodeBuilder.build(
      LayerNode.group([
        Database.node,
        Bus.node,
        SessionProjector.node,
        SessionStore.node,
        Session.node,
        readToolNode,
        Location.node,
        Tool.node,
        Permission.node,
        Agent.node,
        ToolOutput.node,
        SessionModelRequest.node,
        Job.node,
      ]),
      [
        Project.node.replace(globalProjectNode),
        SessionExecution.node.replace(SessionExecution.noopLayer),
        Location.node.replace(tempLocationLayer),
        Config.node.replace(config),
        Image.node.replace(AppNodeBuilder.build(Image.node, [Config.node.replace(config)])),
      ],
    ),
    TestLLM.testLayer(),
  ),
)
const agent = Agent.defaultID
const model = Model.Ref.make({ providerID: Provider.ID.make("fake"), id: Model.ID.make("read-range") })

const fixture = Effect.gen(function* () {
  const agents = yield* Agent.Service
  yield* agents.transform((editor) => editor.update(agent, () => {}))
  const location = yield* Location.Service
  const sessions = yield* Session.Service
  const registry = yield* Tool.Service
  const bus = yield* Bus.Service
  const sessionID = (yield* sessions.create({ location: Location.Ref.make({ directory: location.directory }) })).id
  const file = path.join(location.directory, "short.txt")
  yield* Effect.promise(() => fs.writeFile(file, "one\n"))
  const rules = (effect: "allow" | "ask" | "deny") =>
    sessions.setPermissions({ sessionID, permissions: [{ action: "doom_loop", resource: "read", effect }] })
  yield* rules("allow")
  let sequence = 0
  const message = Effect.gen(function* () {
    const assistantMessageID = SessionMessage.ID.create()
    const publisher = createLLMEventPublisher(bus, {
      sessionID,
      assistantMessageID,
      agent,
      model,
      providerMetadataKey: "fake",
      started: 0,
    })
    return {
      id: assistantMessageID,
      read: (offset: number, inputPath = file, advertisedName = "read") =>
        Effect.gen(function* () {
          const call = LLMEvent.toolCall({
            id: `read-${sequence++}`,
            name: advertisedName,
            input: { path: inputPath, offset, limit: 1 },
          })
          yield* publisher.publish(call)
          const tools = yield* registry.snapshot()
          const definition = tools.definitions.find((tool) => tool.name === "read")
          return yield* tools
            .execute({
              sessionID,
              agent,
              messageID: assistantMessageID,
              call,
              ...(definition ? { definitions: new Map([[advertisedName, definition]]) } : {}),
              progress: (update) => publisher.progress(call.id, update),
            })
            .pipe(
              Effect.flatMap((result) => publisher.toolExecution(call.id, call.name, result)),
              Effect.as(undefined),
              Effect.catchTag("Tool.Error", (error) =>
                publisher.failTool(call.id, toSessionError(error), error.metadata).pipe(Effect.as(error)),
              ),
            )
        }),
    }
  })
  return { sessionID, file, message, rules, sessions, registry, bus }
})

const runStep = Effect.fn("ReadRangeTest.step")(function* (
  current: Effect.Success<typeof fixture>,
  assistantMessageID: SessionMessage.ID,
  isLocationClosed = () => false,
) {
  const tools = yield* current.registry.snapshot()
  const model = SessionRunnerModel.resolved(
    LanguageModel.make({ id: "read-range", provider: "fake", route: OpenAIChat.route }),
    {
      capabilities: { tools: true, input: ["text"], output: ["text"] },
      limit: { context: 100_000, output: 1_000 },
      cost: [],
    },
  )
  const request = yield* SessionModelRequest.Service
  const prepared = yield* request.primary({
    session: yield* current.sessions.get(current.sessionID).pipe(Effect.orDie),
    agent,
    model,
    tools,
    system: [],
    messages: [],
  })
  const steps = yield* SessionStep.make.pipe(
    Effect.provide(
      Layer.mock(Snapshot.Service)({ capture: () => Effect.succeed(undefined), files: () => Effect.succeed([]) }),
    ),
  )
  return yield* steps.attempt({
    isLocationClosed,
    sessionID: current.sessionID,
    assistantMessageID,
    agent,
    model,
    prepared,
    retry: () => Effect.succeed({ retry: true, attempt: 2, delay: 0 }),
    recoverContinuation: true,
    recoverOverflow: Effect.succeed(false),
  })
})

const execution = Effect.fn("ReadRangeTest.execution")(function* (
  current: Effect.Success<typeof fixture>,
  messageID: SessionMessage.ID,
  isLocationClosed: () => boolean,
) {
  const database = yield* Database.Service
  const store = yield* SessionStore.Service
  const jobs = yield* Job.Service
  const services = yield* Effect.context<Effect.Services<ReturnType<typeof runStep>>>()
  const runner = Layer.succeed(
    SessionRunner.Service,
    SessionRunner.Service.of({
      drain: () =>
        runStep(current, messageID, isLocationClosed).pipe(
          Effect.provide(services),
          Effect.as(SessionRunner.DrainResult.Complete()),
        ),
    }),
  )
  const locations = Layer.effect(
    LocationServiceMap.Service,
    LayerMap.make(
      () =>
        // The execution exercises the real step; its location only needs the runner, like session-execution.test.ts.
        // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
        runner as unknown as Layer.Layer<LocationServices, FileSystem.DirectoryNotFoundError>,
    ),
  )
  const scope = yield* Scope.make()
  yield* Effect.addFinalizer(() => Scope.close(scope, Exit.void))
  const context = yield* Layer.buildWithScope(
    SessionExecution.layer.pipe(
      Layer.provide(
        AppNodeBuilder.build(Instance.node, [LocationServiceMap.node.replace(locations)]).pipe(Layer.fresh),
      ),
      Layer.provide(Layer.succeed(Database.Service, database)),
      Layer.provide(Layer.succeed(Bus.Service, current.bus)),
      Layer.provide(Layer.succeed(SessionStore.Service, store)),
      Layer.provide(Layer.succeed(Job.Service, jobs)),
    ),
    scope,
  )
  return { service: Context.get(context, SessionExecution.Service), scope }
})

describe("ReadTool invalid range history", () => {
  it.live("gates after a parallel pair settles without duplicate terminal calls or session leakage", () =>
    Effect.gen(function* () {
      const current = yield* fixture
      yield* current.rules("deny")
      const message = yield* current.message
      const results = yield* Effect.all([message.read(100), message.read(200)], { concurrency: 2 })
      expect(results.map((error) => error?.metadata?.readRangeBlocked)).toEqual([undefined, undefined])
      expect(yield* message.read(300)).toMatchObject({ metadata: { readRangeBlocked: true } })
      const stored = yield* SessionStore.Service.use((store) => store.message(message.id))
      expect(stored?.message.type).toBe("assistant")
      if (stored?.message.type === "assistant") {
        const calls = stored.message.content.filter((part) => part.type === "tool")
        expect(calls.map((call) => call.id)).toEqual(["read-0", "read-1", "read-2"])
        expect(calls.map((call) => call.state.status)).toEqual(["error", "error", "error"])
      }
      const other = yield* fixture
      yield* other.rules("deny")
      const otherMessage = yield* other.message
      expect(yield* otherMessage.read(400)).toMatchObject({
        message: "Offset 400 is out of range for this file (1 line)",
      })
    }),
  )
  for (const action of ["reject", "shutdown"] as const) {
    it.live(`${action} settles the actual execution claim and terminal events`, () =>
      Effect.gen(function* () {
        const current = yield* fixture
        const prior = yield* current.message
        yield* prior.read(100)
        yield* prior.read(200)
        yield* current.sessions.setPermissions({ sessionID: current.sessionID, permissions: [] })
        const permission = yield* Permission.Service
        const store = yield* SessionStore.Service
        const asked = yield* Deferred.make<Permission.Request>()
        const terminals: string[] = []
        const toolTerminals: string[] = []
        const stepTerminals: string[] = []
        const unsubscribe = yield* current.bus.listen((event) => {
          if (event.type === Permission.Event.Asked.type)
            return Deferred.succeed(asked, event.data as Permission.Request).pipe(Effect.asVoid)
          if (
            event.type === SessionEvent.Execution.Failed.type ||
            event.type === SessionEvent.Execution.Interrupted.type ||
            event.type === SessionEvent.Execution.Succeeded.type
          )
            terminals.push(event.type)
          if (event.type === SessionEvent.Tool.Failed.type || event.type === SessionEvent.Tool.Success.type)
            toolTerminals.push(event.type)
          if (event.type === SessionEvent.Step.Failed.type || event.type === SessionEvent.Step.Ended.type)
            stepTerminals.push(event.type)
          return Effect.void
        })
        yield* Effect.addFinalizer(() => unsubscribe)
        const llm = yield* TestLLM.Test
        yield* llm.push(TestLLM.toolCall("guard-request", "read", { path: current.file, offset: 300 }))
        let closed = false
        const messageID = SessionMessage.ID.create()
        const active = yield* execution(current, messageID, () => closed)
        const fiber = yield* active.service.resume(current.sessionID).pipe(Effect.forkScoped)
        const request = yield* Deferred.await(asked)
        expect(yield* store.listSuspended()).toContain(current.sessionID)
        if (action === "shutdown") {
          closed = true
          yield* Scope.close(active.scope, Exit.void)
          expect(yield* store.listSuspended()).toContain(current.sessionID)
          expect(terminals).toEqual([SessionEvent.Execution.Interrupted.type])
        }
        if (action === "reject") {
          yield* permission.reply({ requestID: request.id, reply: "reject" })
          const exit = yield* Fiber.await(fiber)
          expect(Exit.isFailure(exit)).toBe(true)
          if (Exit.isFailure(exit)) expect(Cause.squash(exit.cause)).toBeInstanceOf(StepFailedError)
          expect(yield* store.listSuspended()).not.toContain(current.sessionID)
          expect(terminals).toEqual([SessionEvent.Execution.Failed.type])
          const saved = yield* store.message(messageID)
          expect(saved?.message).toMatchObject({ error: { type: "permission.rejected" } })
        }
        expect(yield* permission.list()).toEqual([])
        expect(toolTerminals).toEqual([SessionEvent.Tool.Failed.type])
        expect(stepTerminals).toEqual([SessionEvent.Step.Failed.type])
      }),
    )
  }
  it.live("honors an explicit allow policy without stopping repeated invalid reads", () =>
    Effect.gen(function* () {
      const current = yield* fixture
      const message = yield* current.message
      for (const offset of [100, 200, 300, 400]) {
        const error = yield* message.read(offset)
        expect(error?.message).toBe(`Offset ${offset} is out of range for this file (1 line)`)
        expect(error?.metadata?.readRangeBlocked).toBeUndefined()
      }
    }),
  )

  it.live("rejects negative and fractional offsets before range history is recorded", () =>
    Effect.gen(function* () {
      const current = yield* fixture
      yield* current.rules("deny")
      const message = yield* current.message
      for (const offset of [-1, 1.5, -1, 1.5]) {
        const error = yield* message.read(offset)
        expect(error?.message).toContain('Invalid arguments for tool "read"')
        expect(error?.metadata?.readRange).toBeUndefined()
      }
      const error = yield* message.read(100)
      expect(error?.message).toBe("Offset 100 is out of range for this file (1 line)")
      expect(error?.metadata?.readRangeBlocked).toBeUndefined()
    }),
  )
  it.live("counts actual read failures when a context hook advertises another tool name", () =>
    Effect.gen(function* () {
      const current = yield* fixture
      yield* current.rules("deny")
      const message = yield* current.message
      yield* message.read(100, current.file, "view")
      yield* message.read(200, current.file, "view")
      expect(yield* message.read(300, current.file, "view")).toMatchObject({ metadata: { readRangeBlocked: true } })
    }),
  )
  it.live("resets for changed bytes even when size and modification time are preserved", () =>
    Effect.gen(function* () {
      const current = yield* fixture
      yield* current.rules("deny")
      const message = yield* current.message
      yield* message.read(100)
      yield* message.read(200)
      const before = yield* Effect.promise(() => fs.stat(current.file))
      yield* Effect.promise(() => fs.writeFile(current.file, "two\n"))
      yield* Effect.promise(() => fs.utimes(current.file, before.atime, before.mtime))
      expect(yield* message.read(300)).toMatchObject({
        message: "Offset 300 is out of range for this file (1 line)",
        metadata: { readRange: { version: Bun.SHA256.hash("two\n", "hex") } },
      })
      yield* message.read(400)
      expect(yield* message.read(500)).toMatchObject({ metadata: { readRangeBlocked: true } })
    }),
  )

  it.live("resets only after user promotion, not queued input or synthetic context", () =>
    Effect.gen(function* () {
      const current = yield* fixture
      yield* current.rules("deny")
      const first = yield* current.message
      yield* first.read(100)
      yield* first.read(200)
      yield* current.bus.publish(SessionEvent.Synthetic, { sessionID: current.sessionID, text: "Continue working" })
      const inboxID = SessionMessage.ID.create()
      yield* current.bus.publish(SessionEvent.InboxEnqueued, {
        sessionID: current.sessionID,
        inboxID,
        item: { type: "user", payload: { text: "Read again" }, delivery: "queue" },
      })
      const queued = yield* current.message
      expect(yield* queued.read(300)).toMatchObject({ metadata: { readRangeBlocked: true } })
      yield* current.bus.publish(SessionEvent.InboxDelivered, { sessionID: current.sessionID, inboxID })
      const promoted = yield* current.message
      expect(yield* promoted.read(400)).toMatchObject({ message: "Offset 400 is out of range for this file (1 line)" })
    }),
  )

  it.live("keeps failures beyond the first history page", () =>
    Effect.gen(function* () {
      const current = yield* fixture
      yield* current.rules("deny")
      const first = yield* current.message
      yield* first.read(100)
      yield* first.read(200)
      for (let index = 0; index < 20; index++)
        yield* current.bus.publish(SessionEvent.Synthetic, { sessionID: current.sessionID, text: `Context ${index}` })
      const later = yield* current.message
      expect(yield* later.read(300)).toMatchObject({ metadata: { readRangeBlocked: true } })
    }),
  )

  it.live("does not mix files or sessions with identical contents", () =>
    Effect.gen(function* () {
      const first = yield* fixture
      yield* first.rules("deny")
      const message = yield* first.message
      yield* message.read(100)
      yield* message.read(200)
      const otherFile = path.join(path.dirname(first.file), "other.txt")
      yield* Effect.promise(() => fs.writeFile(otherFile, "one\n"))
      expect(yield* message.read(300, otherFile)).toMatchObject({
        message: "Offset 300 is out of range for this file (1 line)",
      })
      const second = yield* fixture
      yield* second.rules("deny")
      const otherSession = yield* second.message
      expect(yield* otherSession.read(400)).toMatchObject({
        message: "Offset 400 is out of range for this file (1 line)",
      })
      expect(yield* message.read(500)).toMatchObject({ metadata: { readRangeBlocked: true } })
    }),
  )

  it.live("allows valid and empty-file initial ranges without counting them as failures", () =>
    Effect.gen(function* () {
      const current = yield* fixture
      yield* current.rules("deny")
      const message = yield* current.message
      for (const offset of [0, 1, 1, 1]) expect(yield* message.read(offset)).toBeUndefined()
      yield* Effect.promise(() => fs.writeFile(current.file, ""))
      for (const offset of [0, 1, 1, 1]) expect(yield* message.read(offset)).toBeUndefined()
      const error = yield* message.read(2)
      expect(error?.message).toBe("Offset 2 is out of range for this file (0 lines)")
      expect(error?.metadata?.readRangeBlocked).toBeUndefined()
    }),
  )

  for (const action of ["approve", "reject", "correct", "cancel"] as const) {
    it.live(`preserves ${action} behavior at the default ask gate`, () =>
      Effect.gen(function* () {
        const current = yield* fixture
        const message = yield* current.message
        yield* message.read(100)
        yield* message.read(200)
        // Remove the session override to exercise the built-in default ask rule.
        yield* current.sessions.setPermissions({ sessionID: current.sessionID, permissions: [] })
        const permission = yield* Permission.Service
        const asked = yield* Deferred.make<Permission.Request>()
        const unsubscribe = yield* current.bus.listen((event) =>
          event.type === Permission.Event.Asked.type
            ? Deferred.succeed(asked, event.data as Permission.Request).pipe(Effect.asVoid)
            : Effect.void,
        )
        yield* Effect.addFinalizer(() => unsubscribe)
        const fiber = yield* message.read(300).pipe(Effect.forkScoped)
        const request = yield* Deferred.await(asked)
        expect(request).toMatchObject({
          action: "doom_loop",
          resources: ["read"],
          sessionID: current.sessionID,
          source: { type: "tool", messageID: message.id },
        })
        if (action === "cancel") {
          yield* Fiber.interrupt(fiber)
          expect(yield* permission.list()).toEqual([])
          const error = yield* permission.reply({ requestID: request.id, reply: "once" }).pipe(Effect.flip)
          expect(error).toBeInstanceOf(Permission.NotFoundError)
          return
        }
        yield* permission.reply({
          requestID: request.id,
          reply: action === "approve" ? "once" : "reject",
          ...(action === "correct" ? { message: "Use grep instead" } : {}),
        })
        const exit = yield* Fiber.await(fiber)
        if (action === "reject") {
          expect(Exit.isFailure(exit)).toBe(true)
          if (Exit.isFailure(exit))
            expect(
              exit.cause.reasons.some(
                (reason) => Cause.isDieReason(reason) && reason.defect instanceof Permission.DeclinedError,
              ),
            ).toBe(true)
        }
        if (action === "approve" || action === "correct") {
          expect(Exit.isSuccess(exit)).toBe(true)
          if (Exit.isSuccess(exit))
            expect(exit.value).toMatchObject({
              message: action === "approve" ? "Offset 300 is out of range for this file (1 line)" : "Use grep instead",
              metadata: { readRange: { totalLines: 1 } },
            })
        }
        expect(yield* permission.list()).toEqual([])
      }),
    )
  }
  for (const streamFailure of [false, true]) {
    it.live(`fails the step on configured deny with provider failure ${streamFailure}`, () =>
      Effect.gen(function* () {
        const current = yield* fixture
        const prior = yield* current.message
        yield* prior.read(100)
        yield* prior.read(200)
        yield* current.rules("deny")
        const llm = yield* TestLLM.Test
        const assistantMessageID = SessionMessage.ID.create()
        const call = LLMEvent.toolCall({ id: "denied-range", name: "read", input: { path: current.file, offset: 300 } })
        yield* llm.push(
          streamFailure
            ? TestLLM.failAfter(
                new AIError({
                  reason: new TransportError({
                    message: "Disconnected",
                    transport: "http",
                    operation: "read",
                    recovery: "retry-full",
                  }),
                }),
                LLMEvent.stepStart({ index: 0 }),
                call,
              )
            : TestLLM.toolCalls(call),
        )
        const error = yield* runStep(current, assistantMessageID).pipe(Effect.flip)
        expect(error).toBeInstanceOf(StepFailedError)
        const saved = yield* SessionStore.Service.use((store) => store.message(assistantMessageID))
        expect(saved?.message).toMatchObject({
          error: { type: "doom_loop" },
          content: [{ state: { status: "error", metadata: { readRangeBlocked: true } } }],
        })
      }),
    )
  }
  it.live("gates the third rotating invalid offset across responses despite successful rereads", () =>
    Effect.gen(function* () {
      const current = yield* fixture
      yield* current.rules("deny")
      const first = yield* current.message
      const error = yield* first.read(100)
      expect(error?.message).toBe("Offset 100 is out of range for this file (1 line)")
      expect(error?.metadata).toEqual({
        readRange: { path: current.file, version: Bun.SHA256.hash("one\n", "hex"), totalLines: 1 },
      })
      yield* first.read(1)
      const second = yield* current.message
      yield* second.read(200)
      yield* second.read(1)
      const store = yield* SessionStore.Service
      expect((yield* store.message(first.id))?.message).toMatchObject({
        content: [{ state: { status: "error", metadata: { readRange: { totalLines: 1 } } } }, {}],
      })
      const third = yield* current.message
      expect(yield* third.read(300)).toMatchObject({ metadata: { readRangeBlocked: true } })
      const saved = yield* store.message(third.id)
      expect(saved?.message).toMatchObject({
        content: [{ state: { status: "error", metadata: { readRangeBlocked: true, readRange: { totalLines: 1 } } } }],
      })
    }),
  )

  it.live("includes completed invalid reads from the same response", () =>
    Effect.gen(function* () {
      const current = yield* fixture
      yield* current.rules("deny")
      const message = yield* current.message
      yield* message.read(100)
      yield* message.read(200)
      expect(yield* message.read(300)).toMatchObject({ metadata: { readRangeBlocked: true } })
    }),
  )
})
