import { afterEach, describe, expect } from "bun:test"
import { NodeHttpServer, NodeServices } from "@effect/platform-node"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"
import type { SessionV1 } from "@opencode-ai/core/v1/session"
import { Cause, Config, Deferred, Effect, Exit, Layer, Schema } from "effect"
import { HttpClient, HttpClientRequest, HttpRouter, HttpServer } from "effect/unstable/http"
import { layerWebSocketConstructorGlobal } from "effect/unstable/socket/Socket"
import path from "node:path"
import { BackgroundJob } from "@/background/job"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { AttachmentCoordinator } from "@/session/attachment/coordinator"
import { SessionClosure } from "@/session/closure/coordinator"
import { SessionClosureModel as Model } from "@/session/closure/model"
import type { SessionAdmission } from "@/session/closure/admission"
import { Session } from "@/session/session"
import { MessageID, PartID, SessionID } from "@/session/schema"
import { HttpApiApp } from "@/server/routes/instance/httpapi/server"
import { TaskTool, type TaskPromptOps } from "@/tool/task"
import { ToolRegistry } from "@/tool/registry"
import * as Tool from "@/tool/tool"
import { disposeAllInstances, TestInstance } from "../fixture/fixture"
import { syntheticAdmission } from "../lib/background"
import { admittingJobs } from "../lib/closure"
import { testEffect } from "../lib/effect"
import { TestLLMServer } from "../lib/llm-server"
import { testProviderConfig } from "../lib/test-provider"

type Acquisition = {
  readonly session: SessionID
  readonly source: string
  readonly origin: "external" | "internal"
  readonly type: "admitted" | "fenced"
}

const acquired: Acquisition[] = []
const settled: Array<{ readonly lease: Model.LeaseID; readonly disposition: string }> = []
let refuse: (input: SessionClosure.AcquireInput) => boolean = () => false
let sequence = 0

const closure = Layer.succeed(
  SessionClosure.Service,
  SessionClosure.Service.of({
    // This suite starts REAL background jobs and asserts they complete, so the fake has to admit
    // their binds. `unusedJobs` dies on `jobStart`, and dying is not loud here: the binder catches
    // the whole cause and returns a refusal, so the job simply never arms and reports `cancelled`
    // with nothing anywhere pointing at admission.
    ...admittingJobs,
    request: () => Effect.die("unused request"),
    view: Effect.die("unused view"),
    identity: Effect.succeed({
      instance: Model.id("instance", "instance_task_boundaries"),
      directory: "test",
      worktree: "test",
      project: "test",
      workspace: "test",
    }),
    acquire: (input) =>
      Effect.sync(() => {
        if (refuse(input)) {
          acquired.push({ session: input.session, source: input.source, origin: input.origin, type: "fenced" })
          return {
            type: "fenced" as const,
            state: "closing" as const,
            operation: Model.id("operation", "operation_task_boundaries"),
            epoch: 0n,
          }
        }
        acquired.push({ session: input.session, source: input.source, origin: input.origin, type: "admitted" })
        sequence += 1
        return {
          type: "admitted" as const,
          lease: Model.id("lease", `lease_task_boundaries_${sequence}`),
          epoch: 0n,
          instance: Model.id("instance", "instance_task_boundaries"),
        }
      }),
    bind: () => Effect.void,
    retire: (lease, disposition) =>
      Effect.sync(() => void settled.push({ lease, disposition: disposition ?? "retired" })),
    reserveMutation: () => {
      sequence += 1
      return Effect.succeed({
        type: "reserved" as const,
        mutation: Model.id("mutation", `mutation_task_boundaries_${sequence}`),
      })
    },
    activateMutation: () => Effect.void,
    retireMutation: () => Effect.void,
  }),
)

type Capture = {
  readonly ops: TaskPromptOps
  readonly context: Tool.Context
}

let capture: Capture | undefined
let task: Tool.InferDef<typeof TaskTool> | undefined
let sessions: Session.Interface | undefined
let jobs: BackgroundJob.Interface | undefined
let attachments: AttachmentCoordinator.Interface | undefined

const CaptureParameters = Schema.Struct({})
const captureTool: Tool.Def<typeof CaptureParameters> = {
  id: "capture",
  description: "Capture the production Task prompt capabilities for a boundary test.",
  parameters: CaptureParameters,
  execute: (_args, ctx) =>
    Effect.sync(() => {
      const ops = ctx.extra?.promptOps as TaskPromptOps | undefined
      if (!ops) throw new Error("capture tool did not receive TaskPromptOps")
      capture = { ops, context: ctx }
      return { title: "captured", metadata: {}, output: "captured" }
    }),
}

const registry = Layer.effect(
  ToolRegistry.Service,
  Effect.gen(function* () {
    sessions = yield* Session.Service
    jobs = yield* BackgroundJob.Service
    attachments = yield* AttachmentCoordinator.Service
    const info = yield* TaskTool
    const def = yield* info.init()
    task = { id: info.id, ...def }
    return ToolRegistry.Service.of({
      ids: () => Effect.succeed([captureTool.id, info.id]),
      all: () => Effect.succeed([captureTool, task!]),
      named: () => Effect.die("unused named tools"),
      tools: () => Effect.succeed([captureTool, task!]),
    })
  }),
)
const registryNode = LayerNode.make({
  service: ToolRegistry.Service,
  layer: registry,
  deps: [LayerNode.group(ToolRegistry.node.dependencies), AttachmentCoordinator.node],
})

const replacements = [
  [SessionClosure.node, closure],
  [ToolRegistry.node, registryNode],
] as const satisfies LayerNode.Replacements
const served: Layer.Layer<never, Config.ConfigError, HttpServer.HttpServer> = HttpRouter.serve(
  HttpApiApp.createRoutes(undefined, replacements),
  { disableListenLog: true, disableLogger: true },
)
const http = served.pipe(
  Layer.provide(layerWebSocketConstructorGlobal),
  Layer.provideMerge(NodeHttpServer.layerTest),
  Layer.provideMerge(NodeServices.layer),
)
const it = testEffect(Layer.mergeAll(http, TestLLMServer.layer))

const backgroundReplacements = [
  ...replacements,
  [RuntimeFlags.node, RuntimeFlags.layer({ experimentalBackgroundSubagents: true })],
] as const satisfies LayerNode.Replacements
const backgroundServed: Layer.Layer<never, Config.ConfigError, HttpServer.HttpServer> = HttpRouter.serve(
  HttpApiApp.createRoutes(undefined, backgroundReplacements),
  { disableListenLog: true, disableLogger: true },
)
const backgroundHttp = backgroundServed.pipe(
  Layer.provide(layerWebSocketConstructorGlobal),
  Layer.provideMerge(NodeHttpServer.layerTest),
  Layer.provideMerge(NodeServices.layer),
)
const background = testEffect(Layer.mergeAll(backgroundHttp, TestLLMServer.layer))

const request = (urlPath: string, directory: string, init: RequestInit = {}) => {
  const url = new URL(urlPath, "http://localhost")
  const headers = new Headers(init.headers)
  headers.set("x-opencode-directory", directory)
  return HttpClientRequest.fromWeb(new Request(url, { ...init, headers })).pipe(
    HttpClientRequest.setUrl(url.pathname),
    HttpClient.execute,
  )
}

const bootstrap = Effect.gen(function* () {
  const test = yield* TestInstance
  const llm = yield* TestLLMServer
  const created = yield* request("/session", test.directory, { method: "POST" }).pipe(
    Effect.flatMap((response) => response.json),
    Effect.map((value) => value as Session.Info),
  )
  yield* llm.tool("capture", {})
  yield* llm.text("capture complete")
  const response = yield* request(`/session/${created.id}/message`, test.directory, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      agent: "build",
      model: { providerID: "test", modelID: "test-model" },
      parts: [{ type: "text", text: "capture" }],
    }),
  })
  const body = yield* response.text
  if (response.status !== 200) {
    const calls = yield* llm.calls
    const misses = yield* llm.misses
    return yield* Effect.die(
      new Error(
        `capture prompt failed (${response.status}): ${body}; captured=${capture !== undefined}; calls=${calls}; misses=${JSON.stringify(misses)}; acquisitions=${JSON.stringify(acquired)}`,
      ),
    )
  }
  expect(capture).toBeDefined()
  expect(task).toBeDefined()
  expect(sessions).toBeDefined()
  expect(jobs).toBeDefined()
  expect(attachments).toBeDefined()
  return {
    test,
    llm,
    caller: created,
    capture: capture!,
    task: task!,
    sessions: sessions!,
    jobs: jobs!,
    attachments: attachments!,
  }
})

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

const withOps = (base: Tool.Context, ops: TaskPromptOps): Tool.Context => ({
  ...base,
  abort: new AbortController().signal,
  // PRODUCTION ops throughout this suite: `promptAdmitted` invokes `input.onAdmitted` itself
  // after durable persistence and the conditional own (CP-031 §4.4). No admitting funnel here —
  // pre-firing the callback would mark a fence-refused supplement "admitted" and reclassify its
  // refusal as a post-admission failure (T-26's negative), terminalizing the lifetime against R-24.
  extra: { ...base.extra, promptOps: ops },
})

const quietContinuation: TaskPromptOps["acquireContinuation"] = (input) =>
  Effect.succeed({
    context: {
      coordinator: Model.id("instance", "instance_quiet_continuation"),
      session: input.session,
      leases: [],
      kind: "continuation",
      epoch: 0n,
      origin: "internal",
      retry: "initial",
    },
    observe: <A, E, R>(_body: Effect.Effect<A, E, R>) => Effect.succeed(undefined as A),
  })

const seedUser = (service: Session.Interface, title: string) =>
  Effect.gen(function* () {
    const session = yield* service.create({ title, agent: "build" })
    const message = yield* service.updateMessage({
      id: MessageID.ascending(),
      role: "user",
      sessionID: session.id,
      agent: "build",
      model: { providerID: ProviderV2.ID.make("test"), modelID: ModelV2.ID.make("test-model") },
      time: { created: Date.now() },
    })
    yield* service.updatePart({
      id: PartID.ascending(),
      messageID: message.id,
      sessionID: session.id,
      type: "text",
      text: "continue",
    })
    return session
  })

afterEach(async () => {
  capture = undefined
  task = undefined
  sessions = undefined
  jobs = undefined
  attachments = undefined
  refuse = () => false
  acquired.length = 0
  settled.length = 0
  await disposeAllInstances()
})

describe("Task closure boundaries (CP-023 K82 and K9)", () => {
  it.instance(
    "anchors a fresh child to its caller before executable target work begins (K82)",
    () =>
      Effect.gen(function* () {
        const boot = yield* bootstrap
        yield* boot.llm.reset
        acquired.length = 0
        const parents: Array<SessionID | undefined> = []
        const targets: SessionID[] = []
        const ops: TaskPromptOps = {
          ...boot.capture.ops,
          prompt: (input) =>
            Effect.gen(function* () {
              const child = yield* boot.sessions.get(input.sessionID).pipe(Effect.orDie)
              parents.push(child.parentID)
              targets.push(child.id)
              expect(child.parentID).toBe(boot.caller.id)
              return yield* boot.capture.ops.prompt(input)
            }),
        }

        yield* boot.llm.text("fresh child complete")
        const result = yield* boot.task.execute(
          { description: "fresh child", prompt: "run", subagent_type: "general" },
          withOps(boot.capture.context, ops),
        )

        expect(result.output).toContain("fresh child complete")
        expect(parents).toEqual([boot.caller.id])
        expect(targets).toHaveLength(1)
        expect(
          acquired.filter(
            (item) => item.session === targets[0] && item.source === "TaskPromptOps.prompt" && item.type === "admitted",
          ),
        ).toHaveLength(1)
      }),
    instance,
  )

  // K82's rejection half. The row is discharged by a composition no slice recorded, so record it
  // here: `task.ts:346` is a fail-closed POSITIVE-EQUALITY guard (`session.parentID !== ctx.sessionID`),
  // which is why root targets (parentID undefined) and dangling-parent targets fail the same
  // expression as foreign ones — there is no separate branch per shape to test. Its outcome is
  // already proven by `task.test.ts:1707` ("rejects task_id resume when the child is not owned by
  // the caller"), which asserts `Exit.isFailure` plus "not owned".
  //
  // What no test asserted is ORDERING, and outcome alone cannot supply it: a failure looks identical
  // whether the guard rejected before touching anything or whether target work ran and was rolled
  // back. That distinction is exactly why K108 carries an ordering instrument alongside its
  // outcome one. The ordering is load-bearing here because the guard sits at task.ts:346, ahead of
  // child creation (:559), the caller lease (:605) and the target prompt (:630) — so a rejection
  // must leave all three untouched.
  it.instance(
    "rejects a foreign task_id before any executable target work begins (K82 ordering)",
    () =>
      Effect.gen(function* () {
        const boot = yield* bootstrap
        yield* boot.llm.reset
        acquired.length = 0
        settled.length = 0

        let prompted = 0
        const ops: TaskPromptOps = {
          ...boot.capture.ops,
          prompt: (input) =>
            Effect.sync(() => void (prompted += 1)).pipe(Effect.andThen(boot.capture.ops.prompt(input))),
        }

        // POSITIVE CONTROL. The same instrument, on a delegation that IS permitted, records the
        // prompt and the acquisitions. Without this the zeroes below would equally describe a
        // harness that never reached the tool.
        yield* boot.llm.text("owned delegation complete")
        yield* boot.task.execute(
          { description: "owned", prompt: "run", subagent_type: "general" },
          withOps(boot.capture.context, ops),
        )
        expect(prompted).toBe(1)
        expect(acquired.filter((item) => item.source === "TaskPromptOps.prompt")).toHaveLength(1)

        // A child of a DIFFERENT caller — the exact shape task.ts:346 rejects.
        const other = yield* boot.sessions.create({ parentID: boot.caller.id, title: "other caller" })
        const foreign = yield* boot.sessions.create({
          parentID: other.id,
          title: "foreign child (@general subagent)",
          agent: "general",
        })

        // POSITIVE PRECONDITION. The target exists and is genuinely not the caller's child, so the
        // refusal below is the ownership guard rather than a failed lookup.
        expect((yield* boot.sessions.get(foreign.id)).parentID).toBe(other.id)
        expect(other.id).not.toBe(boot.caller.id)

        yield* boot.llm.reset
        prompted = 0
        acquired.length = 0
        settled.length = 0
        const calls = yield* boot.llm.calls
        const exit = yield* boot.task
          .execute(
            { description: "foreign resume", prompt: "run", subagent_type: "general", task_id: foreign.id },
            withOps(boot.capture.context, ops),
          )
          .pipe(Effect.exit)

        expect(Exit.isFailure(exit)).toBe(true)
        if (Exit.isFailure(exit)) expect(Cause.pretty(exit.cause)).toContain("not owned")

        // THE ORDERING CLAIM. Nothing executable was entered: no target prompt, no admission of any
        // kind (the caller lease at :605 is downstream of the guard too), no lease settlement, and
        // no provider call.
        expect(prompted).toBe(0)
        expect(acquired).toEqual([])
        expect(settled).toEqual([])
        expect((yield* boot.llm.calls) - calls).toBe(0)
      }),
    instance,
  )

  it.instance(
    "admits an extension at TaskPromptOps.prompt and refuses that exact stage without retry (K9 extension)",
    () =>
      Effect.gen(function* () {
        const boot = yield* bootstrap
        const run = (label: string, fenced: boolean) =>
          Effect.gen(function* () {
            yield* boot.llm.reset
            acquired.length = 0
            const child = yield* boot.sessions.create({
              parentID: boot.caller.id,
              title: `${label} (@general subagent)`,
              agent: "general",
            })
            const release = yield* Deferred.make<void>()
            yield* boot.jobs.start({
              admission: syntheticAdmission(),
              id: child.id,
              type: "task",
              title: label,
              run: Deferred.await(release).pipe(Effect.as(undefined)),
            })
            refuse = (input) => fenced && input.session === child.id && input.source === "TaskPromptOps.prompt"
            if (!fenced) yield* boot.llm.text("extension complete")
            const calls = yield* boot.llm.calls
            const ops = { ...boot.capture.ops, acquireContinuation: quietContinuation }
            const receipt = yield* boot.task.execute(
              {
                description: label,
                prompt: "more context",
                subagent_type: "general",
                task_id: child.id,
              },
              withOps(boot.capture.context, ops),
            )
            expect(receipt.output).toContain("task updated")

            // CP-ocp-031 R-01: the supplement registers and admits immediately - it does NOT wait
            // for the owner's still-held run. Its single admission attempt arriving while the
            // owner's Deferred is still open IS the immediate-admission evidence.
            const supplementAcquisition = () =>
              acquired.filter((item) => item.session === child.id && item.source === "TaskPromptOps.prompt")
            yield* Effect.gen(function* () {
              const deadline = Date.now() + 10_000
              while (supplementAcquisition().length === 0) {
                if (Date.now() > deadline) return yield* Effect.die("supplement admission never attempted")
                yield* Effect.sleep(25)
              }
            })
            expect(supplementAcquisition()).toEqual([
              {
                session: child.id,
                source: "TaskPromptOps.prompt",
                origin: "internal",
                type: fenced ? "fenced" : "admitted",
              },
            ])

            yield* Deferred.succeed(release, undefined)
            const waited = yield* boot.jobs.wait({ id: child.id, timeout: 10_000 })
            // Still exactly one attempt after the lifetime settled: a refusal is never retried (U-03).
            expect(supplementAcquisition()).toHaveLength(1)
            // CP-ocp-031 R-24: an admission failure never terminalizes the lifetime. Both passes
            // dispose "completed"; the refused pass carries the admission-failure notice instead.
            expect(waited.info?.status).toBe("completed")
            if (fenced) {
              const notes = waited.info?.notes ?? []
              expect(notes.length).toBe(1)
              expect(notes[0]).toContain("A supplemental prompt could not be admitted:")
              expect(notes[0]).toContain("The task's in-flight turn was not interrupted.")
            } else {
              expect(waited.info?.notes ?? []).toEqual([])
            }
            expect((yield* boot.llm.calls) - calls).toBe(fenced ? 0 : 1)
            refuse = () => false
          })

        yield* run("admitted extension", false)
        yield* run("refused extension", true)
      }),
    instance,
  )

  it.instance(
    "acquires the result continuation on the caller and refuses before an observer exists (K9 result)",
    () =>
      Effect.gen(function* () {
        const boot = yield* bootstrap
        yield* boot.llm.reset
        acquired.length = 0
        settled.length = 0
        const target = SessionID.make("ses_k9_result_target")
        const input: SessionAdmission.ContinuationInput = {
          session: boot.caller.id,
          caller: boot.caller.id,
          target,
          source: "TaskTool.notifyBackgroundResult",
        }
        const held = yield* boot.capture.ops.acquireContinuation(input)
        let bodies = 0
        yield* held.observe(Effect.sync(() => void (bodies += 1)))
        expect(bodies).toBe(1)
        expect(acquired).toEqual([
          {
            session: boot.caller.id,
            source: "TaskTool.notifyBackgroundResult",
            origin: "internal",
            type: "admitted",
          },
        ])
        expect(settled).toHaveLength(1)
        expect(settled[0]?.disposition).toBe("retired")

        acquired.length = 0
        settled.length = 0
        refuse = (current) => current.session === boot.caller.id && current.source === "TaskTool.notifyBackgroundResult"
        const refusal = yield* boot.capture.ops.acquireContinuation(input).pipe(Effect.flip)
        expect(refusal._tag).toBe("SessionClosureAdmissionRefused")
        expect(acquired).toEqual([
          {
            session: boot.caller.id,
            source: "TaskTool.notifyBackgroundResult",
            origin: "internal",
            type: "fenced",
          },
        ])
        expect(settled).toEqual([])
        expect(bodies).toBe(1)
      }),
    instance,
  )

  background.instance(
    "refuses the real Task result notifier before scheduling its observer (K9 result)",
    () =>
      Effect.gen(function* () {
        const boot = yield* bootstrap
        yield* boot.llm.reset
        acquired.length = 0
        settled.length = 0
        refuse = (input) => input.session === boot.caller.id && input.source === "TaskTool.notifyBackgroundResult"
        yield* boot.llm.text("background result complete")
        const calls = yield* boot.llm.calls

        const receipt = yield* boot.task.execute(
          {
            description: "refused result notifier",
            prompt: "run in background",
            subagent_type: "general",
            async: true,
          },
          withOps(boot.capture.context, boot.capture.ops),
        )
        expect(receipt.output).toContain("Async task started")
        const child = receipt.metadata.sessionId
        if (!child) return yield* Effect.die("background Task receipt omitted its child Session")
        const waited = yield* boot.jobs.wait({ id: child, timeout: 10_000 })
        expect(waited.timedOut).toBe(false)
        expect(waited.info?.status).toBe("completed")
        expect((yield* boot.llm.calls) - calls).toBe(1)

        const notifications = acquired.filter((item) => item.source === "TaskTool.notifyBackgroundResult")
        expect(notifications).toEqual([
          {
            session: boot.caller.id,
            source: "TaskTool.notifyBackgroundResult",
            origin: "internal",
            type: "fenced",
          },
        ])
        // A refused acquisition creates no continuation lease and therefore no observer settlement.
        // The only settlements are the admitted caller and target-prompt leases proved above.
        expect(settled).toHaveLength(acquired.filter((item) => item.type === "admitted").length)
      }),
    instance,
  )

  it.instance(
    "carries the exact attachment through production wake and refuses before provider execution (K9 wake)",
    () =>
      Effect.gen(function* () {
        const boot = yield* bootstrap
        if (!boot.capture.ops.wake) return yield* Effect.die("TaskPromptOps.wake is missing")
        yield* boot.llm.reset
        acquired.length = 0

        const admitted = yield* seedUser(boot.sessions, "wake admitted")
        const admittedScope = yield* boot.attachments.open(admitted.id)
        const admittedReservation = yield* admittedScope.reserve(SessionID.create())
        expect((yield* admittedScope.claimObserver(admittedReservation)).type).toBe("owner")
        const admittedTerminal = yield* admittedScope.terminal(admittedReservation)
        if (!admittedTerminal) return yield* Effect.die("admitted wake did not terminalize")
        yield* admittedScope.settleTerminal(admittedTerminal)
        expect(yield* admittedScope.beginWake()).toBe(true)

        yield* boot.llm.text("wake complete")
        const before = yield* boot.llm.calls
        const result = yield* boot.capture.ops
          .wake(admitted.id, admittedScope)
          .pipe(Effect.ensuring(admittedScope.endWake()))
        expect(result.parts.findLast((part) => part.type === "text")?.text).toBe("wake complete")
        expect((yield* boot.llm.calls) - before).toBe(1)
        // Generic `loop({ sessionID })` can make the same provider call, but cannot record this
        // clean turn on the exact attachment generation. This is the capability-carriage oracle.
        expect(admittedScope.current().candidate).toBe(true)
        expect(
          acquired.filter((item) => item.session === admitted.id && item.source === "SessionRunState.ensureRunning"),
        ).toEqual([
          { session: admitted.id, source: "SessionRunState.ensureRunning", origin: "internal", type: "admitted" },
        ])
        yield* admittedScope.finishContinuation()
        const selected = yield* admittedScope.result(result)
        expect(selected).toMatchObject({
          type: "evidence",
          candidate: {
            assistant: { parts: expect.arrayContaining([expect.objectContaining({ text: "wake complete" })]) },
          },
        })
        yield* admittedScope.close()

        const blocked = yield* seedUser(boot.sessions, "wake refused")
        const blockedScope = yield* boot.attachments.open(blocked.id)
        const blockedReservation = yield* blockedScope.reserve(SessionID.create())
        expect((yield* blockedScope.claimObserver(blockedReservation)).type).toBe("owner")
        const blockedTerminal = yield* blockedScope.terminal(blockedReservation)
        if (!blockedTerminal) return yield* Effect.die("blocked wake did not terminalize")
        yield* blockedScope.settleTerminal(blockedTerminal)
        expect(yield* blockedScope.beginWake()).toBe(true)

        acquired.length = 0
        const calls = yield* boot.llm.calls
        refuse = (input) => input.session === blocked.id && input.source === "SessionRunState.ensureRunning"
        const refusal = yield* boot.capture.ops
          .wake(blocked.id, blockedScope)
          .pipe(Effect.ensuring(blockedScope.endWake()), Effect.flip)
        expect(refusal._tag).toBe("SessionClosureAdmissionRefused")
        expect(yield* boot.llm.calls).toBe(calls)
        expect(blockedScope.current().candidate).toBe(false)
        expect(acquired).toEqual([
          { session: blocked.id, source: "SessionRunState.ensureRunning", origin: "internal", type: "fenced" },
        ])
        yield* blockedScope.claimCancellation("fenced wake")
        yield* blockedScope.finishContinuation()
        yield* blockedScope.close()
      }),
    instance,
  )
})
