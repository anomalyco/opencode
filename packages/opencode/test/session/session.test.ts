import { describe, expect } from "bun:test"
import { Deferred, Effect, Exit, Layer } from "effect"
import { Session as SessionNs } from "@/session/session"
import { GlobalBus, type GlobalEvent } from "../../src/bus/global"
import * as Log from "@opencode-ai/core/util/log"
import { MessageV2 } from "../../src/session/message-v2"
import { MessageID, PartID, type SessionID } from "../../src/session/schema"
import { ModelID, ProviderID } from "../../src/provider/schema"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { provideInstance, tmpdirScoped } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import { Bus } from "@/bus"
import { Storage } from "@/storage/storage"
import { SyncEvent } from "@/sync"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { BackgroundJob } from "@/background/job"

void Log.init({ print: false })

const it = testEffect(
  Layer.mergeAll(
    SessionNs.layer.pipe(
      Layer.provide(Bus.layer),
      Layer.provide(Storage.defaultLayer),
      Layer.provide(SyncEvent.defaultLayer),
      Layer.provide(RuntimeFlags.layer({ experimentalWorkspaces: false })),
      Layer.provide(BackgroundJob.defaultLayer),
    ),
    CrossSpawnSpawner.defaultLayer,
  ),
)

const ref = {
  providerID: ProviderID.make("test"),
  modelID: ModelID.make("test-model"),
}

const awaitDeferred = <T>(deferred: Deferred.Deferred<T>, message: string) =>
  Effect.race(
    Deferred.await(deferred),
    Effect.sleep("2 seconds").pipe(Effect.flatMap(() => Effect.fail(new Error(message)))),
  )

const remove = (id: SessionID) => SessionNs.use.remove(id)

const subscribeGlobal = (type: string, callback: (event: NonNullable<GlobalEvent["payload"]>) => void) => {
  const listener = (event: GlobalEvent) => {
    if (event.payload?.type === type) callback(event.payload)
  }
  GlobalBus.on("event", listener)
  return () => GlobalBus.off("event", listener)
}

describe("session.created event", () => {
  it.instance("should emit session.created event when session is created", () =>
    Effect.gen(function* () {
      const session = yield* SessionNs.Service
      const received = yield* Deferred.make<SessionNs.Info>()

      const unsub = subscribeGlobal(SessionNs.Event.Created.type, (event) => {
        Deferred.doneUnsafe(received, Effect.succeed(event.properties.info as SessionNs.Info))
      })
      yield* Effect.addFinalizer(() => Effect.sync(unsub))

      const info = yield* session.create({})
      const receivedInfo = yield* awaitDeferred(received, "timed out waiting for session.created")

      expect(receivedInfo.id).toBe(info.id)
      expect(receivedInfo.projectID).toBe(info.projectID)
      expect(receivedInfo.directory).toBe(info.directory)
      expect(receivedInfo.path).toBe(info.path)
      expect(receivedInfo.title).toBe(info.title)

      yield* session.remove(info.id)
    }),
  )

  it.instance("session.created event should be emitted before session.updated", () =>
    Effect.gen(function* () {
      const session = yield* SessionNs.Service
      const events: string[] = []
      const received = yield* Deferred.make<string[]>()
      const push = (event: string) => {
        events.push(event)
        if (events.includes("created") && events.includes("updated")) {
          Deferred.doneUnsafe(received, Effect.succeed(events))
        }
      }

      const unsubCreated = subscribeGlobal(SessionNs.Event.Created.type, () => {
        push("created")
      })
      yield* Effect.addFinalizer(() => Effect.sync(unsubCreated))

      const unsubUpdated = subscribeGlobal(SessionNs.Event.Updated.type, () => {
        push("updated")
      })
      yield* Effect.addFinalizer(() => Effect.sync(unsubUpdated))

      const info = yield* session.create({})
      const receivedEvents = yield* awaitDeferred(received, "timed out waiting for session created/updated events")

      expect(receivedEvents).toContain("created")
      expect(receivedEvents).toContain("updated")
      expect(receivedEvents.indexOf("created")).toBeLessThan(receivedEvents.indexOf("updated"))

      yield* session.remove(info.id)
    }),
  )
})

describe("step-finish token propagation via Bus event", () => {
  it.instance(
    "non-zero tokens propagate through PartUpdated event",
    () =>
      Effect.gen(function* () {
        const session = yield* SessionNs.Service
        const info = yield* session.create({})

        const messageID = MessageID.ascending()
        yield* session.updateMessage({
          id: messageID,
          sessionID: info.id,
          role: "user",
          time: { created: Date.now() },
          agent: "user",
          model: { providerID: "test", modelID: "test" },
          tools: {},
          mode: "",
        } as unknown as MessageV2.Info)

        // Bus subscribers receive readonly Schema.Type payloads; `MessageV2.Part`
        // is the mutable domain type. Cast bridges the two — safe because the
        // test only reads the value afterwards.
        const received = yield* Deferred.make<MessageV2.Part>()
        const unsub = subscribeGlobal(MessageV2.Event.PartUpdated.type, (event) => {
          Deferred.doneUnsafe(received, Effect.succeed(event.properties.part as MessageV2.Part))
        })
        yield* Effect.addFinalizer(() => Effect.sync(unsub))

        const tokens = {
          total: 1500,
          input: 500,
          output: 800,
          reasoning: 200,
          cache: { read: 100, write: 50 },
        }

        const partInput = {
          id: PartID.ascending(),
          messageID,
          sessionID: info.id,
          type: "step-finish" as const,
          reason: "stop",
          cost: 0.005,
          tokens,
        }

        yield* session.updatePart(partInput)
        const receivedPart = yield* awaitDeferred(received, "timed out waiting for message.part.updated")

        expect(receivedPart.type).toBe("step-finish")
        const finish = receivedPart as MessageV2.StepFinishPart
        expect(finish.tokens.input).toBe(500)
        expect(finish.tokens.output).toBe(800)
        expect(finish.tokens.reasoning).toBe(200)
        expect(finish.tokens.total).toBe(1500)
        expect(finish.tokens.cache.read).toBe(100)
        expect(finish.tokens.cache.write).toBe(50)
        expect(finish.cost).toBe(0.005)
        expect(receivedPart).not.toBe(partInput)

        yield* session.remove(info.id)
      }),
    { timeout: 30000 },
  )
})

describe("orphaned assistant recovery", () => {
  it.instance("finalizes incomplete assistant messages and aborts running tools", () =>
    Effect.gen(function* () {
      const session = yield* SessionNs.Service
      const info = yield* session.create({})
      const user = yield* session.updateMessage({
        id: MessageID.ascending(),
        sessionID: info.id,
        role: "user",
        time: { created: Date.now() },
        agent: "build",
        model: ref,
      })
      const assistant = yield* session.updateMessage({
        id: MessageID.ascending(),
        sessionID: info.id,
        parentID: user.id,
        role: "assistant",
        mode: "build",
        agent: "build",
        path: { cwd: "/tmp", root: "/tmp" },
        cost: 0,
        tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
        modelID: ref.modelID,
        providerID: ref.providerID,
        time: { created: Date.now() },
      } satisfies MessageV2.Assistant)
      const started = Date.now()
      yield* session.updatePart({
        id: PartID.ascending(),
        messageID: assistant.id,
        sessionID: info.id,
        type: "tool",
        callID: "call_orphaned_task",
        tool: "task",
        state: {
          status: "running",
          input: { description: "inspect bug" },
          metadata: { sessionId: "ses_child" },
          time: { start: started },
        },
      } satisfies MessageV2.ToolPart)

      yield* session.finalizeOrphanedAssistant(info.id)

      const messages = yield* session.messages({ sessionID: info.id })
      const last = messages.at(-1)
      expect(last?.info.role).toBe("assistant")
      if (!last || last.info.role !== "assistant") return

      expect(last.info.time.completed).toBeNumber()
      expect(last.info.error?.name).toBe("MessageAbortedError")

      const tool = last.parts.find((part): part is MessageV2.ToolPart => part.type === "tool")
      expect(tool?.state.status).toBe("error")
      if (!tool || tool.state.status !== "error") return

      expect(tool.state.error).toBe("Tool execution aborted")
      expect(tool.state.input).toEqual({ description: "inspect bug" })
      expect(tool.state.metadata?.interrupted).toBe(true)
      expect(tool.state.metadata?.sessionId).toBe("ses_child")
      expect(tool.state.time.start).toBe(started)
      expect(tool.state.time.end).toBeNumber()

      yield* session.remove(info.id)
    }),
  )

  it.instance("finalizes orphaned child sessions when task metadata was not persisted", () =>
    Effect.gen(function* () {
      const session = yield* SessionNs.Service
      const parent = yield* session.create({})
      const user = yield* session.updateMessage({
        id: MessageID.ascending(),
        sessionID: parent.id,
        role: "user",
        time: { created: Date.now() },
        agent: "build",
        model: ref,
      })
      const assistant = yield* session.updateMessage({
        id: MessageID.ascending(),
        sessionID: parent.id,
        parentID: user.id,
        role: "assistant",
        mode: "build",
        agent: "build",
        path: { cwd: "/tmp", root: "/tmp" },
        cost: 0,
        tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
        modelID: ref.modelID,
        providerID: ref.providerID,
        time: { created: Date.now() },
      } satisfies MessageV2.Assistant)
      const firstTask = yield* session.updatePart({
        id: PartID.ascending(),
        messageID: assistant.id,
        sessionID: parent.id,
        type: "tool",
        callID: "call_orphaned_child_a",
        tool: "task",
        state: {
          status: "running",
          input: { description: "learn examples", subagent_type: "explore" },
          time: { start: Date.now() },
        },
      } satisfies MessageV2.ToolPart)
      const secondTask = yield* session.updatePart({
        id: PartID.ascending(),
        messageID: assistant.id,
        sessionID: parent.id,
        type: "tool",
        callID: "call_orphaned_child_b",
        tool: "task",
        state: {
          status: "running",
          input: { description: "read draft", subagent_type: "explore" },
          time: { start: Date.now() },
        },
      } satisfies MessageV2.ToolPart)

      const childA = yield* session.create({
        parentID: parent.id,
        title: "learn examples (@Explorer - Search Specialist subagent)",
      })
      const childAUser = yield* session.updateMessage({
        id: MessageID.ascending(),
        sessionID: childA.id,
        role: "user",
        time: { created: Date.now() },
        agent: "explore",
        model: ref,
      })
      const childAAssistant = yield* session.updateMessage({
        id: MessageID.ascending(),
        sessionID: childA.id,
        parentID: childAUser.id,
        role: "assistant",
        mode: "explore",
        agent: "explore",
        path: { cwd: "/tmp", root: "/tmp" },
        cost: 0,
        tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
        modelID: ref.modelID,
        providerID: ref.providerID,
        time: { created: Date.now() },
      } satisfies MessageV2.Assistant)
      yield* session.updatePart({
        id: PartID.ascending(),
        messageID: childAAssistant.id,
        sessionID: childA.id,
        type: "tool",
        callID: "call_child_glob",
        tool: "glob",
        state: {
          status: "running",
          input: { pattern: "*.wls" },
          time: { start: Date.now() },
        },
      } satisfies MessageV2.ToolPart)

      const childB = yield* session.create({
        parentID: parent.id,
        title: "read draft (@Explorer - Search Specialist subagent)",
      })
      const childBUser = yield* session.updateMessage({
        id: MessageID.ascending(),
        sessionID: childB.id,
        role: "user",
        time: { created: Date.now() },
        agent: "explore",
        model: ref,
      })
      yield* session.updateMessage({
        id: MessageID.ascending(),
        sessionID: childB.id,
        parentID: childBUser.id,
        role: "assistant",
        mode: "explore",
        agent: "explore",
        path: { cwd: "/tmp", root: "/tmp" },
        cost: 0,
        tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
        modelID: ref.modelID,
        providerID: ref.providerID,
        time: { created: Date.now() },
      } satisfies MessageV2.Assistant)

      yield* session.finalizeOrphanedAssistant(parent.id)

      const parentMessages = yield* session.messages({ sessionID: parent.id })
      const recoveredParent = parentMessages.find((item) => item.info.id === assistant.id)
      expect(recoveredParent?.info.role).toBe("assistant")
      if (!recoveredParent || recoveredParent.info.role !== "assistant") return
      expect(recoveredParent.info.time.completed).toBeNumber()

      const recoveredFirst = recoveredParent.parts.find(
        (part): part is MessageV2.ToolPart => part.type === "tool" && part.id === firstTask.id,
      )
      const recoveredSecond = recoveredParent.parts.find(
        (part): part is MessageV2.ToolPart => part.type === "tool" && part.id === secondTask.id,
      )
      expect(recoveredFirst?.state.status).toBe("error")
      expect(recoveredSecond?.state.status).toBe("error")
      if (!recoveredFirst || recoveredFirst.state.status !== "error") return
      if (!recoveredSecond || recoveredSecond.state.status !== "error") return
      expect(recoveredFirst.state.metadata?.interrupted).toBe(true)
      expect(recoveredFirst.state.metadata?.sessionId).toBe(childA.id)
      expect(recoveredSecond.state.metadata?.interrupted).toBe(true)
      expect(recoveredSecond.state.metadata?.sessionId).toBe(childB.id)

      const childAMessages = yield* session.messages({ sessionID: childA.id })
      const recoveredChildA = childAMessages.find((item) => item.info.id === childAAssistant.id)
      expect(recoveredChildA?.info.role).toBe("assistant")
      if (!recoveredChildA || recoveredChildA.info.role !== "assistant") return
      expect(recoveredChildA.info.time.completed).toBeNumber()
      const childATool = recoveredChildA.parts.find((part): part is MessageV2.ToolPart => part.type === "tool")
      expect(childATool?.state.status).toBe("error")
      if (!childATool || childATool.state.status !== "error") return
      expect(childATool.state.metadata?.interrupted).toBe(true)

      const childBMessages = yield* session.messages({ sessionID: childB.id })
      const recoveredChildB = childBMessages.find((item) => item.info.role === "assistant")
      expect(recoveredChildB?.info.role).toBe("assistant")
      if (!recoveredChildB || recoveredChildB.info.role !== "assistant") return
      expect(recoveredChildB.info.time.completed).toBeNumber()

      yield* session.remove(parent.id)
    }),
  )
})

describe("session archive state", () => {
  it.instance("can clear archived time with null", () =>
    Effect.gen(function* () {
      const session = yield* SessionNs.Service
      const info = yield* session.create({})

      yield* session.setArchived({ sessionID: info.id, time: Date.now() })
      expect((yield* session.get(info.id)).time.archived).toBeDefined()

      yield* session.setArchived({ sessionID: info.id, time: null })
      expect((yield* session.get(info.id)).time.archived).toBeUndefined()

      yield* session.remove(info.id)
    }),
  )
})
