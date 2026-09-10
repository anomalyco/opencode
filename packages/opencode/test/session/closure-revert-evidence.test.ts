import { afterEach, describe, expect } from "bun:test"
import { NodeHttpServer, NodeServices } from "@effect/platform-node"
import { Database } from "@opencode-ai/core/database/database"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { EventV2 } from "@opencode-ai/core/event"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { MessageTable, PartTable } from "@opencode-ai/core/session/sql"
import { CLOSURE_RECORD_METADATA_KEY } from "@opencode-ai/core/session/closure-record"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { Config, Effect, Exit, Layer, Schema } from "effect"
import { HttpClient, HttpClientRequest, HttpRouter, HttpServer } from "effect/unstable/http"
import { and, eq } from "drizzle-orm"
import path from "node:path"
import { GlobalBus, type GlobalEvent } from "@/bus/global"
import { EventV2Bridge } from "@/event-v2-bridge"
import { SessionClosure } from "@/session/closure/coordinator"
import { SessionClosureModel as Model } from "@/session/closure/model"
import { SessionClosurePorts as Ports } from "@/session/closure/ports"
import { SessionClosureRecord } from "@/session/closure/record"
import { SessionRevert } from "@/session/revert"
import { MessageID, PartID, SessionID } from "@/session/schema"
import { Session } from "@/session/session"
import { HttpApiApp } from "@/server/routes/instance/httpapi/server"
import { TaskTool, type TaskPromptOps } from "@/tool/task"
import { ToolRegistry } from "@/tool/registry"
import * as Tool from "@/tool/tool"
import { disposeAllInstances, TestInstance } from "../fixture/fixture"
import { persistHistoricalMessage } from "../lib/closure-record"
import { testEffect } from "../lib/effect"
import { TestLLMServer } from "../lib/llm-server"
import { testProviderConfig } from "../lib/test-provider"

// CP-023 Gate 5 G6. The record publisher/interruption half of §18 step 5 already lives in
// closure-record-interruption.test.ts. These tests exercise its missing preservation half through
// the real writer, ordinary cleanup, next prompt, Task resume, and whole-Session deletion paths.

type Captured = {
  readonly sessions: Session.Interface
  readonly revert: SessionRevert.Interface
  readonly closure: SessionClosure.Interface
  readonly database: Database.Interface
  readonly events: EventV2.Interface
  readonly task: Tool.InferDef<typeof TaskTool>
}

let captured: Captured | undefined
let taskContext: { readonly ops: TaskPromptOps; readonly context: Tool.Context } | undefined
let recordCapability: SessionClosureRecord.Interface | undefined

const capturingRecord = Layer.effect(
  SessionClosureRecord.Service,
  Effect.gen(function* () {
    const service = yield* SessionClosureRecord.Service
    recordCapability = service
    return service
  }),
).pipe(Layer.provide(SessionClosureRecord.layer))
const capturingRecordNode = LayerNode.make({
  service: SessionClosureRecord.Service,
  layer: capturingRecord,
  deps: [SessionProjector.node],
})

const CaptureParameters = Schema.Struct({})
const captureTool: Tool.Def<typeof CaptureParameters> = {
  id: "capture-g6",
  description: "Capture production Task prompt capabilities for closure-evidence tests.",
  parameters: CaptureParameters,
  execute: (_args, ctx) =>
    Effect.sync(() => {
      const ops = ctx.extra?.promptOps as TaskPromptOps | undefined
      if (!ops) throw new Error("G6 capture tool did not receive TaskPromptOps")
      taskContext = { ops, context: ctx }
      return { title: "captured", metadata: {}, output: "captured" }
    }),
}

const registry = Layer.effect(
  ToolRegistry.Service,
  Effect.gen(function* () {
    const sessions = yield* Session.Service
    const revert = yield* SessionRevert.Service
    const closure = yield* SessionClosure.Service
    const database = yield* Database.Service
    const events = yield* EventV2Bridge.Service
    const info = yield* TaskTool
    const task = { id: info.id, ...(yield* info.init()) }
    captured = { sessions, revert, closure, database, events, task }
    return ToolRegistry.Service.of({
      ids: () => Effect.succeed([captureTool.id, info.id]),
      all: () => Effect.succeed([captureTool, task]),
      named: () => Effect.die("unused named tools"),
      tools: () => Effect.succeed([captureTool, task]),
    })
  }),
)
const registryNode = LayerNode.make({
  service: ToolRegistry.Service,
  layer: registry,
  deps: [LayerNode.group(ToolRegistry.node.dependencies), SessionRevert.node, SessionClosure.node],
})

const replacements = [
  [ToolRegistry.node, registryNode],
  [SessionClosureRecord.node, capturingRecordNode],
] as const satisfies LayerNode.Replacements
const served: Layer.Layer<never, Config.ConfigError, HttpServer.HttpServer> = HttpRouter.serve(
  HttpApiApp.createRoutes(undefined, replacements),
  { disableListenLog: true, disableLogger: true },
)
const http = served.pipe(Layer.provideMerge(NodeHttpServer.layerTest), Layer.provideMerge(NodeServices.layer))
const it = testEffect(Layer.mergeAll(http, TestLLMServer.layer))

const instance = {
  git: true,
  init: (directory: string) =>
    TestLLMServer.pipe(
      Effect.flatMap((llm) =>
        Effect.promise(() =>
          Bun.write(path.join(directory, "opencode.json"), JSON.stringify(testProviderConfig(llm.url))),
        ),
      ),
      Effect.asVoid,
    ),
}

const request = (urlPath: string, directory: string, init: RequestInit = {}) => {
  const url = new URL(urlPath, "http://localhost")
  const headers = new Headers(init.headers)
  headers.set("x-opencode-directory", directory)
  return HttpClientRequest.fromWeb(new Request(url, { ...init, headers })).pipe(
    HttpClientRequest.setUrl(url.pathname),
    HttpClient.execute,
  )
}

const post = (directory: string, urlPath: string, body: object) =>
  request(urlPath, directory, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })

const create = (directory: string) =>
  post(directory, "/session", { title: "Pinned" }).pipe(
    Effect.flatMap((response) => response.json),
    Effect.map((value) => value as Session.Info),
  )

const services = () => {
  if (!captured) throw new Error("G6 production services were not captured")
  return captured
}

const seedUser = Effect.fn("G6.seedUser")(function* (sessionID: SessionID, text: string) {
  const value = services()
  const info = yield* value.sessions.updateMessage({
    id: MessageID.ascending(),
    role: "user" as const,
    sessionID,
    agent: "build",
    model: { providerID: ProviderV2.ID.make("test"), modelID: ModelV2.ID.make("test-model") },
    time: { created: Date.now() },
  })
  const part = yield* value.sessions.updatePart({
    id: PartID.ascending(),
    sessionID,
    messageID: info.id,
    type: "text" as const,
    text,
  })
  return { info, part }
})

const seedAssistant = Effect.fn("G6.seedAssistant")(function* (
  sessionID: SessionID,
  parentID: MessageID,
  text: string,
  directory: string,
) {
  const value = services()
  const info: SessionV1.Assistant = {
    id: MessageID.ascending(),
    role: "assistant",
    parentID,
    sessionID,
    mode: "build",
    agent: "build",
    cost: 0,
    path: { cwd: directory, root: directory },
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    providerID: ProviderV2.ID.make("test"),
    modelID: ModelV2.ID.make("test-model"),
    time: { created: Date.now() },
  }
  yield* value.sessions.updateMessage(info)
  yield* value.sessions.updatePart({
    id: PartID.ascending(),
    sessionID,
    messageID: info.id,
    type: "text" as const,
    text,
  })
  return info
})

const writeClosure = Effect.fn("G6.writeClosure")(function* (
  sessionID: SessionID,
  label: string,
  kind: "self" | "edge" | "root",
  outcome: Model.TerminalOutcome,
) {
  const value = services()
  const subject = Model.id("session", sessionID)
  const child = Model.id("session", `ses_g6_child_${label}`)
  const operation = Model.id("operation", `g6_${label}_${sessionID}`)
  const repair = Model.id("repair", `g6_${label}_${sessionID}`)
  const factID = Model.id("fact", `g6_${label}_${sessionID}`)
  const key = `${kind}:${sessionID}:${label}`
  const fact: Model.FactView =
    kind === "self"
      ? { type: "self", id: factID, key, subject, outcome, yielded: false }
      : kind === "edge"
        ? { type: "edge", id: factID, key, subject: child, owner: subject, child, outcome, yielded: false }
        : { type: "root", id: factID, key, root: subject }
  const identity: Model.Identity = {
    source: "session_identity",
    agent: "build",
    model: { providerID: "test", modelID: "test-model", variant: { present: false } },
  }
  const common = {
    version: 1 as const,
    freeze_owner_operation_id: operation,
    generation: 1,
    fact_key: key,
    identity_source: "session_identity" as const,
  }
  const metadata: Model.RecordMetadata =
    kind === "self"
      ? { ...common, record_kind: "self", subject_session_id: subject, terminal_outcome: outcome }
      : kind === "edge"
        ? {
            ...common,
            record_kind: "edge",
            subject_session_id: child,
            owner_session_id: subject,
            child_session_id: child,
            terminal_outcome: outcome,
          }
        : {
            ...common,
            record_kind: "root",
            requested_root_session_id: subject,
            subject_session_id: subject,
            branch_outcome: "quiesced",
          }
  const sentence =
    outcome === "completed"
      ? "The tracked execution completed before cancellation took effect."
      : outcome === "cancelled"
        ? "Cancellation won physical closure."
        : outcome === "error"
          ? "The tracked execution ended with an error before cancellation took effect."
          : "The terminal outcome could not be established."
  const text =
    kind === "self"
      ? `[Branch closure] This Session's prior Task execution: ${sentence}`
      : kind === "edge"
        ? `[Branch closure] Child Session ${child}: ${sentence} Owner Session: ${subject}.`
        : `[Branch closure] Requested Session ${subject}: Its in-scope Task branch reached conversational quiescence.`
  const messageID = MessageID.ascending()
  const partID = PartID.ascending()
  const message = Model.id("message", messageID)
  const part = Model.id("part", partID)
  const messageEvent = Model.id("event", `evt_g6_message_${messageID}`)
  const partEvent = Model.id("event", `evt_g6_part_${partID}`)
  const messageTime = Date.now()
  const partTime = messageTime + 1
  const pair: Model.FrozenPair = {
    fact,
    freezeOwner: operation,
    generation: 1,
    identity,
    message,
    part,
    messageEvent,
    partEvent,
    messageTime,
    partTime,
    synthetic: true,
    text,
    metadata,
    messageBytes: JSON.stringify({ id: message, event: messageEvent, time: messageTime, synthetic: true, identity }),
    partBytes: JSON.stringify({
      id: part,
      event: partEvent,
      time: partTime,
      synthetic: true,
      text,
      metadata,
    }),
  }
  const candidate: Model.PairCandidate = {
    type: "pair.candidate",
    operation,
    repair,
    revision: 0n,
    freezeOwner: operation,
    generation: 1,
    fact: factID,
    expectedPrefix: 0,
  }
  const command: Extract<Ports.ExternalCommand, { readonly type: "pair.write" }> = {
    type: "pair.write",
    instance: Model.id("instance", `g6_${label}`),
    permit: Model.id("pair", `g6_${label}_${messageID}`),
    candidate,
  }
  if (!recordCapability) return yield* Effect.die("G6 real record capability was not captured")
  expect(yield* recordCapability.write({ command, record: pair })).toEqual({ message: "verified", part: "verified" })
  return { pair, messageID, partID }
})

const lookalike = Effect.fn("G6.lookalike")(function* (sessionID: SessionID, metadata: Model.RecordMetadata) {
  const info: SessionV1.User = {
    id: MessageID.ascending(),
    role: "user",
    sessionID,
    agent: "build",
    model: { providerID: ProviderV2.ID.make("test"), modelID: ModelV2.ID.make("test-model") },
    time: { created: Date.now() },
  }
  const part: SessionV1.TextPart = {
    id: PartID.ascending(),
    sessionID,
    messageID: info.id,
    type: "text",
    text: "lookalike with wrong bounded text",
    synthetic: true,
    metadata: { [CLOSURE_RECORD_METADATA_KEY]: metadata },
  }
  yield* persistHistoricalMessage({ info, parts: [part] }).pipe(
    Effect.provideService(Database.Service, services().database),
  )
  return { info, part }
})

const partial = Effect.fn("G6.partial")(function* (sessionID: SessionID, pair: Model.FrozenPair) {
  const info: SessionV1.User = {
    id: MessageID.ascending(),
    role: "user",
    sessionID,
    agent: "build",
    model: { providerID: ProviderV2.ID.make("test"), modelID: ModelV2.ID.make("test-model") },
    time: { created: Date.now() },
  }
  const part: SessionV1.TextPart = {
    id: PartID.ascending(),
    sessionID,
    messageID: info.id,
    type: "text",
    text: pair.text,
    synthetic: true,
    metadata: { [CLOSURE_RECORD_METADATA_KEY]: pair.metadata },
  }
  const companion: SessionV1.TextPart = {
    id: PartID.ascending(),
    sessionID,
    messageID: info.id,
    type: "text",
    text: "second Part makes this pair incomplete",
  }
  yield* persistHistoricalMessage({ info, parts: [part, companion] }).pipe(
    Effect.provideService(Database.Service, services().database),
  )
  return { info, part }
})

const bootstrap = Effect.gen(function* () {
  const test = yield* TestInstance
  const llm = yield* TestLLMServer
  const caller = yield* create(test.directory)
  yield* llm.tool(captureTool.id, {})
  yield* llm.text("capture complete")
  const response = yield* post(test.directory, `/session/${caller.id}/message`, {
    agent: "build",
    model: { providerID: "test", modelID: "test-model" },
    parts: [{ type: "text", text: "capture production capabilities" }],
  })
  expect(response.status).toBe(200)
  if (!taskContext) return yield* Effect.die("G6 capture tool did not run")
  return { test, llm, caller, capture: taskContext, value: services() }
})

const context = (base: Tool.Context, sessionID: SessionID, messageID: MessageID, ops: TaskPromptOps): Tool.Context => ({
  ...base,
  sessionID,
  messageID,
  abort: new AbortController().signal,
  extra: { promptOps: ops },
})

afterEach(async () => {
  captured = undefined
  taskContext = undefined
  recordCapability = undefined
  await disposeAllInstances()
})

describe("closure evidence through revert cleanup (CP-023 K101/K102)", () => {
  // K88 next-actual-prompt history clause, alongside K101 cleanup preservation. Mutant: apply cleanup
  // or generic synthetic filtering to complete pairs; red: durable rows or their ordered model-wire
  // evidence disappear before the next real prompt.
  it.instance(
    "K101: cleanup deletes generic tail rows but preserves complete closure pairs in next-prompt order",
    () =>
      Effect.gen(function* () {
        const boot = yield* bootstrap
        const session = yield* boot.value.sessions.create({ title: "K101 evidence" })
        const prior = yield* seedUser(session.id, "K101 prior input")
        const boundary = yield* seedAssistant(session.id, prior.info.id, "K101 reverted answer", boot.test.directory)
        yield* boot.value.sessions.setRevert({
          sessionID: session.id,
          revert: { messageID: boundary.id },
          summary: undefined,
        })
        const first = yield* writeClosure(session.id, "k101_first", "self", "completed")
        const fake = yield* lookalike(session.id, first.pair.metadata)
        const incomplete = yield* partial(session.id, first.pair)
        const second = yield* writeClosure(session.id, "k101_second", "edge", "error")
        const third = yield* writeClosure(session.id, "k101_third", "root", "unknown")
        const ordinary = yield* seedUser(session.id, "K101 ordinary tail")

        expect(first.messageID > boundary.id).toBe(true)
        expect(fake.info.id > boundary.id).toBe(true)
        expect(incomplete.info.id > boundary.id).toBe(true)
        expect(second.messageID > boundary.id).toBe(true)
        expect(third.messageID > boundary.id).toBe(true)
        expect(ordinary.info.id > boundary.id).toBe(true)
        const before = yield* boot.value.sessions.messages({ sessionID: session.id })
        expect(before.map((item) => item.info.id)).toEqual([
          prior.info.id,
          boundary.id,
          first.messageID,
          fake.info.id,
          incomplete.info.id,
          second.messageID,
          third.messageID,
          ordinary.info.id,
        ])

        const removed: string[] = []
        const bridged: string[] = []
        const unsubscribe = yield* boot.value.events.listen((event) => {
          if (event.type === SessionV1.Event.MessageRemoved.type)
            removed.push((event.data as typeof SessionV1.Event.MessageRemoved.data.Type).messageID)
          return Effect.void
        })
        yield* Effect.addFinalizer(() => unsubscribe)
        const listener = (event: GlobalEvent) => {
          if (event.payload?.type === SessionV1.Event.MessageRemoved.type)
            bridged.push(event.payload.properties.messageID)
        }
        GlobalBus.on("event", listener)
        yield* Effect.addFinalizer(() => Effect.sync(() => GlobalBus.off("event", listener)))

        yield* boot.llm.reset
        yield* boot.llm.text("K101 next answer")
        const response = yield* post(boot.test.directory, `/session/${session.id}/message`, {
          agent: "build",
          model: { providerID: "test", modelID: "test-model" },
          parts: [{ type: "text", text: "K101 next actual input" }],
        })
        expect(response.status).toBe(200)

        const expectedRemoved = [boundary.id, fake.info.id, incomplete.info.id, ordinary.info.id]
        expect(removed).toEqual(expectedRemoved)
        expect(bridged).toEqual(expectedRemoved)
        const after = yield* boot.value.sessions.messages({ sessionID: session.id })
        expect(after.some((item) => item.info.id === boundary.id)).toBe(false)
        expect(after.some((item) => item.info.id === fake.info.id)).toBe(false)
        expect(after.some((item) => item.info.id === incomplete.info.id)).toBe(false)
        expect(after.some((item) => item.info.id === ordinary.info.id)).toBe(false)
        expect(
          after
            .filter((item) => [first.messageID, second.messageID, third.messageID].includes(item.info.id))
            .map((item) => item.info.id),
        ).toEqual([first.messageID, second.messageID, third.messageID])
        expect((yield* boot.value.sessions.get(session.id)).revert).toBeUndefined()

        const inputs = yield* boot.llm.inputs
        expect(inputs).toHaveLength(1)
        const wire = JSON.stringify(inputs[0])
        expect(wire).toContain(first.pair.text)
        expect(wire).toContain(second.pair.text)
        expect(wire).toContain(third.pair.text)
        expect(wire).toContain("K101 next actual input")
        expect(wire.indexOf(first.pair.text)).toBeLessThan(wire.indexOf(second.pair.text))
        expect(wire.indexOf(second.pair.text)).toBeLessThan(wire.indexOf(third.pair.text))
        expect(wire.indexOf(third.pair.text)).toBeLessThan(wire.indexOf("K101 next actual input"))
      }),
    instance,
  )

  it.instance(
    "K102: task_id resume sees preserved evidence, while whole-Session deletion still cascades it",
    () =>
      Effect.gen(function* () {
        const boot = yield* bootstrap
        const created = yield* boot.value.sessions.create({
          parentID: boot.caller.id,
          title: "K102 existing Task child",
          agent: "general",
        })
        const child = created.id
        const initial = yield* seedUser(child, "K102 initial child input")
        const boundary = yield* seedAssistant(child, initial.info.id, "K102 reverted child answer", boot.test.directory)
        yield* boot.value.sessions.setRevert({
          sessionID: child,
          revert: { messageID: boundary.id },
          summary: undefined,
        })
        const record = yield* writeClosure(child, "k102_resume", "self", "completed")
        const ordinary = yield* seedUser(child, "K102 ordinary tail")
        expect(record.messageID > boundary.id).toBe(true)
        expect(ordinary.info.id > boundary.id).toBe(true)

        yield* boot.llm.reset
        yield* boot.llm.text("K102 resumed answer")
        yield* boot.value.task.execute(
          {
            description: "K102 child",
            prompt: "K102 resume actual input",
            subagent_type: "general",
            task_id: child,
          },
          context(boot.capture.context, boot.caller.id, boot.capture.context.messageID, boot.capture.ops),
        )
        const inputs = yield* boot.llm.inputs
        expect(inputs).toHaveLength(1)
        const wire = JSON.stringify(inputs[0])
        expect(wire).toContain(record.pair.text)
        expect(wire).toContain("K102 resume actual input")
        expect(wire.indexOf(record.pair.text)).toBeLessThan(wire.indexOf("K102 resume actual input"))
        const resumed = yield* boot.value.sessions.messages({ sessionID: child })
        expect(resumed.some((item) => item.info.id === record.messageID)).toBe(true)
        expect(resumed.some((item) => item.info.id === ordinary.info.id)).toBe(false)

        const valueBefore = yield* boot.value.closure.view
        expect(valueBefore.fences).toEqual([])
        const mutationsBefore = new Set(valueBefore.mutations.map((item) => item.id))
        const messageBefore = yield* boot.value.database.db
          .select()
          .from(MessageTable)
          .where(and(eq(MessageTable.session_id, child), eq(MessageTable.id, record.messageID)))
          .get()
          .pipe(Effect.orDie)
        const partBefore = yield* boot.value.database.db
          .select()
          .from(PartTable)
          .where(and(eq(PartTable.session_id, child), eq(PartTable.id, record.partID)))
          .get()
          .pipe(Effect.orDie)
        expect(messageBefore).toBeDefined()
        expect(partBefore).toBeDefined()

        yield* boot.value.sessions.remove(child)
        const deletion = (yield* boot.value.closure.view).mutations.filter(
          (item) => !mutationsBefore.has(item.id) && item.kind === "remove_session",
        )
        expect(deletion).toHaveLength(1)
        expect(deletion[0]?.kind).toBe("remove_session")
        expect(deletion[0]?.sessions).toEqual([Model.id("session", child)])
        expect(deletion[0]?.state).toBe("retired")
        expect(Exit.isFailure(yield* boot.value.sessions.get(child).pipe(Effect.exit))).toBe(true)
        expect(
          yield* boot.value.database.db
            .select()
            .from(MessageTable)
            .where(and(eq(MessageTable.session_id, child), eq(MessageTable.id, record.messageID)))
            .get()
            .pipe(Effect.orDie),
        ).toBeUndefined()
        expect(
          yield* boot.value.database.db
            .select()
            .from(PartTable)
            .where(and(eq(PartTable.session_id, child), eq(PartTable.id, record.partID)))
            .get()
            .pipe(Effect.orDie),
        ).toBeUndefined()
      }),
    instance,
  )
})
