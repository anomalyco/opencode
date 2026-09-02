import { afterEach, describe, expect } from "bun:test"
import { NodeHttpServer, NodeServices } from "@effect/platform-node"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"
import type { SessionV1 } from "@opencode-ai/core/v1/session"
import { Cause, Config, Deferred, Effect, Exit, Fiber, Layer, Option, Schema } from "effect"
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
import { SessionRunState } from "@/session/run-state"
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
let runState: SessionRunState.Interface | undefined
let waitHandleHook: (
  input: Parameters<BackgroundJob.Interface["waitHandle"]>[0],
  status: BackgroundJob.Info["status"] | undefined,
) => void = () => {}

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
    const background = yield* BackgroundJob.Service
    jobs = {
      ...background,
      waitHandle: (input) =>
        background
          .waitHandle(input)
          .pipe(Effect.tap((waited) => Effect.sync(() => waitHandleHook(input, waited.info?.status)))),
    }
    attachments = yield* AttachmentCoordinator.Service
    runState = yield* SessionRunState.Service
    const info = yield* TaskTool.pipe(Effect.provideService(BackgroundJob.Service, jobs))
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
  expect(runState).toBeDefined()
  return {
    test,
    llm,
    caller: created,
    capture: capture!,
    task: task!,
    sessions: sessions!,
    jobs: jobs!,
    attachments: attachments!,
    runState: runState!,
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
  runState = undefined
  waitHandleHook = () => {}
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

  // CP-032 R-08, through PRODUCTION `promptAdmitted`. The coordinator suite proves the refusal
  // decision; this proves what the refusal COSTS end to end, which is the half that decided the
  // design. The alternative considered was holding scope ownership across persistence so this case
  // could succeed instead of refusing. It was rejected on merit: CP-032 B-7 retains typed
  // pre-admission refusals as sanitized notes, the shipped copy discloses the persisted prompt, and
  // `ownLatestUser` adopts it on a later scoped run — so nothing is lost — while a hold would add an
  // indefinite gate-stall surface to core quiescence. This test is what makes that claim checkable.
  // Declared on `background.instance`, NOT `it.instance`: this oracle drives `executeSupplement`
  // through `task_id`, which only exists when `experimentalBackgroundSubagents` is on. `it.instance`
  // does not layer that flag, so the test passed only while the developer's shell happened to export
  // OPENCODE_EXPERIMENTAL_BACKGROUND_SUBAGENTS -- proving nothing in a scrubbed environment. The
  // `background` layer sets the flag explicitly (see `backgroundReplacements`), which makes the
  // proof independent of shell state.
  background.instance(
    "refuses a supplement onto a resolved attachment scope as a disclosed note, not a lost prompt (CP-032 R-08)",
    () =>
      Effect.gen(function* () {
        const boot = yield* bootstrap
        const child = yield* boot.sessions.create({
          parentID: boot.caller.id,
          title: "resolved scope (@general subagent)",
          agent: "general",
        })
        const release = yield* Deferred.make<void>()
        yield* boot.jobs.start({
          admission: syntheticAdmission(),
          id: child.id,
          type: "task",
          title: "resolved scope",
          run: Deferred.await(release).pipe(Effect.as(undefined)),
        })

        // Force the capture-to-use race through the REAL seam. `executeSupplement` has already made
        // its borrow decision by the time it calls `ops.prompt`; resolving the scope here, before
        // delegating to production `promptAdmitted`, reproduces exactly the interleaving that cannot
        // be ruled out by checking borrowability first — the scope was live at lookup and resolves
        // before ownership. A never-attached scope takes `result()`'s immediate arm, publishing a
        // resolution and setting `closed` WITHOUT unregistering.
        const settled = (sessionID: SessionID) => {
          const messageID = MessageID.ascending()
          return {
            info: {
              id: messageID,
              role: "assistant",
              parentID: MessageID.ascending(),
              sessionID,
              mode: "test",
              agent: "general",
              path: { cwd: "/tmp", root: "/tmp" },
              cost: 0,
              tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
              modelID: ModelV2.ID.make("test-model"),
              providerID: ProviderV2.ID.make("test"),
              time: { created: Date.now(), completed: Date.now() },
              finish: "stop",
            },
            parts: [{ id: PartID.ascending(), messageID, sessionID, type: "text", text: "settled answer" }],
          } as SessionV1.WithParts
        }

        // The wrapper is the race, and it wraps PRODUCTION rather than replacing it: `promptAdmitted`
        // still runs underneath, so the refusal, its classification and its note are the shipped
        // ones. Resolving the scope here also proves the atomic replacement in `open` is not a
        // sufficient answer on its own — it repairs a scope resolved at LOOKUP, and this one resolves
        // after the borrow decision has already been made.
        // Counts crossings of the exact boundary this refusal sits on. `promptAdmitted` persists the
        // User message and its Parts FIRST, then joins the scope, and only then fires `onAdmitted`.
        // Wrapping the callback rather than replacing it keeps production classification intact
        // while making "the refusal landed after durable persistence but before Task's `onAdmitted`
        // flag" an assertion instead of an inference from the note alone.
        const admitted = { value: 0 }
        const raced: TaskPromptOps["prompt"] = (input) =>
          Effect.gen(function* () {
            if (input.attachmentScope) yield* input.attachmentScope.result(settled(input.sessionID))
            return yield* boot.capture.ops.prompt({
              ...input,
              onAdmitted: Effect.sync(() => {
                admitted.value += 1
              }).pipe(Effect.andThen(input.onAdmitted ?? Effect.void)),
            })
          })

        const calls = yield* boot.llm.calls
        const receipt = yield* boot.task.execute(
          {
            description: "supplement onto resolved scope",
            prompt: "more context",
            subagent_type: "general",
            task_id: child.id,
          },
          withOps(boot.capture.context, {
            ...boot.capture.ops,
            acquireContinuation: quietContinuation,
            prompt: raced,
          }),
        )
        expect(receipt.output).toContain("task updated")

        yield* Deferred.succeed(release, undefined)
        const waited = yield* boot.jobs.wait({ id: child.id, timeout: 10_000 })

        // CP-031 R-24: an admission failure never terminalizes the lifetime.
        expect(waited.info?.status).toBe("completed")
        const notes = waited.info?.notes ?? []
        expect(notes).toHaveLength(1)
        expect(notes[0]).toContain("A supplemental prompt could not be admitted:")
        expect(notes[0]).toContain("The task's in-flight turn was not interrupted.")
        // The disclosure is the load-bearing half: the caller is TOLD the prompt may be persisted,
        // which is what makes a truthful refusal an accepted outcome rather than a silent loss.
        expect(notes[0]).toContain("The prompt may already be recorded in the task transcript.")

        // The exact boundary. Production persisted the prompt and then refused the scope join, so
        // the callback that would have reclassified this as a POST-admission failure never ran.
        // Without this, the note above is consistent with a refusal anywhere upstream.
        expect(admitted.value).toBe(0)

        // Durable persistence really happened — this is the cost the note discloses, and it is
        // what makes `ownLatestUser` able to adopt the message on a later scoped run rather than
        // the prompt being silently dropped.
        const transcript = yield* boot.sessions.messages({ sessionID: child.id })
        const persisted = transcript.filter(
          (message) =>
            message.info.role === "user" &&
            message.parts.some((part) => part.type === "text" && part.text.includes("more context")),
        )
        expect(persisted).toHaveLength(1)
        expect(persisted[0]?.parts.some((part) => part.type === "text")).toBe(true)

        // No wrong execution: the refused supplement never reached the provider, and the child
        // produced no Assistant turn for it.
        expect((yield* boot.llm.calls) - calls).toBe(0)
        expect(transcript.some((message) => message.info.role === "assistant")).toBe(false)

        // No stale filing. The scope resolved holding "settled answer"; a supplement that ignored
        // the refusal would replay that resolution and file it as this prompt's answer. It must
        // appear in no delivered surface.
        expect(waited.info?.output).toBeUndefined()
        expect(JSON.stringify({ notes, output: waited.info?.output })).not.toContain("settled answer")
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

  /**
   * ADMISSION FRESHNESS AT THE PRODUCTION RUNNER SEAM — P1 and P2.
   *
   * The coordinator suite drives `Scope.result()` directly, which proves the decision but not that
   * the chain feeding it exists in production. Every Task-attachment fixture elsewhere stubs
   * `ops.prompt` and hand-calls `own()`/`observeTurn()`, so those rows would keep passing even if
   * `SessionPrompt` stopped enrolling turns altogether — the membership under test would be the
   * membership the fixture wrote. These two arms remove that gap: `ops.prompt` DELEGATES to the
   * captured production capability, so each child turn runs
   * `promptAdmitted` -> durable `own()` -> `runLoop` -> production `observeTurn` before Task's
   * `eligible`/`result` ever sees it, and the Assistant identity compared inside the coordinator is
   * the one the real Runner produced.
   *
   * Only the PARENT ingress is intercepted. Delivery is a prompt into the caller session, and
   * replacing it with a recorder is what turns "which answers reached the caller, in what order"
   * into a directly readable list; the child side is untouched production throughout.
   *
   * The oracle is delivery COUNT and payload identity, because the filing guard keys on the
   * controlling selected position: consuming a resolution files the position that resolution already
   * holds and is deduplicated into silence, while returning fresh evidence files a distinct position
   * and delivers again. One answer versus two is therefore the visible shadow of covered versus
   * uncovered, at the seam where it actually decides a caller's result.
   */
  describe("Admission Freshness at the production Runner seam (CP-032 §3.3.2)", () => {
    const injectedText = (parts: Parameters<TaskPromptOps["prompt"]>[0]["parts"]) =>
      parts.map((part) => (part.type === "text" ? part.text : "")).join("")

    const acknowledged = (sessionID: SessionID): SessionV1.WithParts => {
      const messageID = MessageID.ascending()
      return {
        info: {
          id: messageID,
          role: "assistant",
          parentID: MessageID.ascending(),
          sessionID,
          mode: "test",
          agent: "build",
          path: { cwd: "/tmp", root: "/tmp" },
          cost: 0,
          tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          modelID: ModelV2.ID.make("test-model"),
          providerID: ProviderV2.ID.make("test"),
          time: { created: Date.now(), completed: Date.now() },
          finish: "stop",
        },
        parts: [{ id: PartID.ascending(), messageID, sessionID, type: "text", text: "parent acknowledged" }],
      } as SessionV1.WithParts
    }

    /**
     * P1 — COVERED HISTORY SURVIVES DISPLACEMENT.
     *
     * R1's real Runner produces and observes A1; its Task fiber is paused at the provider return,
     * BEFORE `eligible`, so it has announced nothing and filed nothing. A supplemental prompt then
     * admits through production `promptAdmitted`, whose `own()` invalidates the candidate slot A1
     * occupied, runs its own turn, and publishes a clean resolution selecting A2. A1 is gone from
     * every slot the resolution carries — it survives only in the frozen membership. Releasing R1
     * makes it arrive as a covered ID, so it consumes A2's selection and files A2's position, which
     * the guard already holds.
     *
     * KILLS, at the production seam: omitting `observeTurn`'s enrolment, clearing history on
     * `invalidate()`, and matching the frozen {fallback, candidate, observed} trio instead of
     * membership. Under each, A1 is uncovered, comes back as fresh evidence, files its own distinct
     * position, and the caller receives a SECOND answer carrying the superseded yield.
     */
    background.instance(
      "P1: a displaced yield consumes the later selection and files nothing of its own",
      () =>
        Effect.gen(function* () {
          const boot = yield* bootstrap
          yield* boot.llm.reset
          acquired.length = 0

          const deliveries: string[] = []
          const firstDelivery = yield* Deferred.make<void>()
          const observed = yield* Deferred.make<void>()
          const detected = yield* Deferred.make<void>()
          const release = yield* Deferred.make<void>()
          const childRuns = { value: 0 }

          const ops: TaskPromptOps = {
            ...boot.capture.ops,
            // Wraps rather than replaces: the production acquisition, lease and observation all run.
            // The only addition is a completion signal, so the final counts are read after the
            // observer has finished its whole drain rather than at an arbitrary moment.
            acquireContinuation: (input) =>
              boot.capture.ops.acquireContinuation(input).pipe(
                Effect.map((held) => ({
                  ...held,
                  observe: <A, E, R>(body: Effect.Effect<A, E, R>) =>
                    held.observe(body).pipe(Effect.ensuring(Deferred.succeed(observed, undefined))),
                })),
              ),
            prompt: (input) =>
              Effect.gen(function* () {
                if (input.sessionID === boot.caller.id) {
                  deliveries.push(injectedText(input.parts))
                  yield* Deferred.succeed(firstDelivery, undefined)
                  return acknowledged(boot.caller.id)
                }
                const position = ++childRuns.value
                // PRODUCTION. Returns only after the real Runner has recorded this turn on the exact
                // attachment generation, so the pause below sits between a genuine `observeTurn` and
                // Task's `eligible` — the exact window §3.3.2 exists to decide.
                const result = yield* boot.capture.ops.prompt(input)
                if (position === 1) {
                  yield* Deferred.succeed(detected, undefined)
                  yield* Deferred.await(release)
                }
                return result
              }),
          }

          yield* boot.llm.text("A1 yield")
          yield* boot.llm.text("A2 final")

          const receipt = yield* boot.task.execute(
            { description: "displaced yield", prompt: "run", subagent_type: "general", async: true },
            withOps(boot.capture.context, ops),
          )
          expect(receipt.output).toContain("Async task started")
          const child = receipt.metadata.sessionId
          if (!child) return yield* Effect.die("async Task receipt omitted its child Session")
          yield* Deferred.await(detected)

          // PRECONDITION. R1 is paused before eligibility, so the scope is still live and unresolved
          // and the supplement below genuinely BORROWS it rather than opening its own.
          expect(yield* boot.attachments.locateBorrowable(SessionID.make(child))).toBeDefined()

          const supplement = yield* boot.task.execute(
            { description: "displacing run", prompt: "more context", subagent_type: "general", task_id: child },
            withOps(boot.capture.context, ops),
          )
          expect(supplement.output).toContain("task updated")

          // A2 publishes and delivers while R1 is still paused — R1 announced nothing, so no ordering
          // floor withholds this.
          yield* Deferred.await(firstDelivery)
          expect(deliveries).toHaveLength(1)
          expect(deliveries[0]).toContain("A2 final")

          yield* Deferred.succeed(release, undefined)
          const waited = yield* boot.jobs.wait({ id: child, timeout: 10_000 })
          expect(waited.timedOut).toBe(false)
          expect(waited.info?.status).toBe("completed")
          yield* Deferred.await(observed)

          // NOT VACUOUS: both runs really executed against the real Runner and left their Assistants
          // in the child transcript. Without this, "one delivery" would also describe a supplement
          // that never ran.
          const transcript = yield* boot.sessions.messages({ sessionID: SessionID.make(child) })
          const answers = transcript
            .filter((message) => message.info.role === "assistant")
            .flatMap((message) => message.parts.filter((part) => part.type === "text").map((part) => part.text))
          expect(answers).toContain("A1 yield")
          expect(answers).toContain("A2 final")

          // THE ORACLE. Exactly one answer reached the caller, and it is A2's. A1 was covered, so it
          // consumed A2's selection and filed A2's already-held position.
          expect(deliveries).toHaveLength(1)
          expect(deliveries[0]).toContain("A2 final")
          expect(deliveries.join("\n")).not.toContain("A1 yield")
        }),
      instance,
    )

    /**
     * P2 — A STILL-PRODUCING RUN IS NOT COVERED.
     *
     * The mirror image, and the reason freshness cannot be a degraded-only rule. R2 admits for real
     * — `own()` has run, so the candidate slot is invalidated — but its provider stream is held open,
     * so it has produced nothing when R1 is released and publishes a CLEAN resolution. R2's later
     * observation arrives after publication and is refused outright, so it never enrols; its
     * `result(A2)` therefore finds an uncovered ID and returns fresh evidence, which files a distinct
     * position and reaches the caller as a second answer.
     *
     * KILLS: consuming any pre-published evidence unconditionally, applying freshness only to
     * degraded resolutions, and enrolling the arriving ID before comparing it. Under each, R2
     * consumes R1's resolution, files R1's already-held position, and its answer disappears into the
     * filing guard — one delivery where there must be two.
     */
    background.instance(
      "P2: a run still producing at publication files its own distinct answer",
      () =>
        Effect.gen(function* () {
          const boot = yield* bootstrap
          yield* boot.llm.reset
          acquired.length = 0

          const deliveries: string[] = []
          const firstDelivery = yield* Deferred.make<void>()
          const observed = yield* Deferred.make<void>()
          const detected = yield* Deferred.make<void>()
          const release = yield* Deferred.make<void>()
          const admitted = yield* Deferred.make<void>()
          const childRuns = { value: 0 }
          // The provider-side latch: `hold` streams the role chunk, awaits this, then streams the
          // text and finish. R2 is therefore past admission and inside its turn, with no Assistant
          // content yet, for exactly as long as this stays pending.
          let releaseStream: (() => void) | undefined
          const stream = new Promise<void>((resolve) => {
            releaseStream = resolve
          })

          const ops: TaskPromptOps = {
            ...boot.capture.ops,
            acquireContinuation: (input) =>
              boot.capture.ops.acquireContinuation(input).pipe(
                Effect.map((held) => ({
                  ...held,
                  observe: <A, E, R>(body: Effect.Effect<A, E, R>) =>
                    held.observe(body).pipe(Effect.ensuring(Deferred.succeed(observed, undefined))),
                })),
              ),
            prompt: (input) =>
              Effect.gen(function* () {
                if (input.sessionID === boot.caller.id) {
                  deliveries.push(injectedText(input.parts))
                  yield* Deferred.succeed(firstDelivery, undefined)
                  return acknowledged(boot.caller.id)
                }
                const position = ++childRuns.value
                if (position === 2) {
                  // Signals AFTER production's own callback, so "admitted" means the User message is
                  // durable and `own()` has already invalidated the turn's prior evidence.
                  return yield* boot.capture.ops.prompt({
                    ...input,
                    onAdmitted: (input.onAdmitted ?? Effect.void).pipe(
                      Effect.andThen(Deferred.succeed(admitted, undefined)),
                    ),
                  })
                }
                const result = yield* boot.capture.ops.prompt(input)
                yield* Deferred.succeed(detected, undefined)
                yield* Deferred.await(release)
                return result
              }),
          }

          yield* boot.llm.text("A1 final")
          yield* boot.llm.hold("A2 final", stream)

          const receipt = yield* boot.task.execute(
            { description: "clean mint race", prompt: "run", subagent_type: "general", async: true },
            withOps(boot.capture.context, ops),
          )
          expect(receipt.output).toContain("Async task started")
          const child = receipt.metadata.sessionId
          if (!child) return yield* Effect.die("async Task receipt omitted its child Session")
          yield* Deferred.await(detected)

          const supplement = yield* boot.task.execute(
            { description: "still producing", prompt: "more context", subagent_type: "general", task_id: child },
            withOps(boot.capture.context, ops),
          )
          expect(supplement.output).toContain("task updated")
          // R2 owns the scope but has produced nothing. This ordering is the whole test: publication
          // must happen while a genuinely admitted run is still outstanding.
          yield* Deferred.await(admitted)

          yield* Deferred.succeed(release, undefined)
          yield* Deferred.await(firstDelivery)
          expect(deliveries).toHaveLength(1)
          expect(deliveries[0]).toContain("A1 final")

          // Only now may R2 produce. Its observation lands on a resolved, closed scope and is refused,
          // so nothing enrols it retroactively.
          yield* Effect.sync(() => releaseStream?.())
          const waited = yield* boot.jobs.wait({ id: child, timeout: 10_000 })
          expect(waited.timedOut).toBe(false)
          expect(waited.info?.status).toBe("completed")
          yield* Deferred.await(observed)

          const transcript = yield* boot.sessions.messages({ sessionID: SessionID.make(child) })
          const answers = transcript
            .filter((message) => message.info.role === "assistant")
            .flatMap((message) => message.parts.filter((part) => part.type === "text").map((part) => part.text))
          expect(answers).toContain("A1 final")
          expect(answers).toContain("A2 final")

          // THE ORACLE. Two distinct answers, in sequence order, neither suppressed. A2 was never a
          // member, so it spoke for itself instead of vanishing behind A1's filed position.
          expect(deliveries).toHaveLength(2)
          expect(deliveries[0]).toContain("A1 final")
          expect(deliveries[1]).toContain("A2 final")
        }),
      instance,
    )

    const terminalProjection = (terminal: "cancelled" | "error") =>
      Effect.gen(function* () {
        const boot = yield* bootstrap
        yield* boot.llm.reset
        acquired.length = 0

        const earlierText = `K14 earlier successful Assistant (${terminal})`
        const parent = yield* boot.attachments.open(boot.caller.id)
        const resultEntered = yield* Deferred.make<void>()
        const firstResultDone = yield* Deferred.make<void>()
        const laterOwned = yield* Deferred.make<void>()
        const releaseAdmission = yield* Deferred.make<void>()
        const delivered = yield* Deferred.make<void>()
        const owner: {
          scope?: AttachmentCoordinator.Scope
          earlier?: SessionV1.WithParts
        } = {}
        const activity = { active: 0, wakes: 0 }
        const wrapped = new Map<SessionID, AttachmentCoordinator.Scope>()
        let resultCalls = 0

        const wrap = (scope: AttachmentCoordinator.Scope) => {
          const instrumented: AttachmentCoordinator.Scope = {
            ...scope,
            claimObserver: (reservation) =>
              scope.claimObserver(reservation).pipe(
                Effect.tap((claim) =>
                  Effect.sync(() => {
                    if (claim.type === "owner") activity.active++
                  }),
                ),
              ),
            finishContinuation: () =>
              scope.finishContinuation().pipe(
                Effect.tap(() =>
                  Effect.sync(() => {
                    if (activity.active > 0) activity.active--
                  }),
                ),
              ),
            beginWake: () =>
              scope.beginWake().pipe(
                Effect.tap((started) =>
                  Effect.sync(() => {
                    if (started) activity.wakes++
                  }),
                ),
              ),
            endWake: () =>
              scope.endWake().pipe(
                Effect.tap(() =>
                  Effect.sync(() => {
                    if (activity.wakes > 0) activity.wakes--
                  }),
                ),
              ),
            result: (fallback) => {
              resultCalls++
              if (resultCalls !== 1) return scope.result(fallback)
              owner.earlier = fallback
              return Effect.gen(function* () {
                const pending = yield* scope
                  .result(fallback)
                  .pipe(Effect.ensuring(Deferred.succeed(firstResultDone, undefined)), Effect.forkChild)
                // The child fiber runs the real synchronous `Scope.result` transition before it
                // parks. One scheduler handoff therefore establishes the first-fallback latch
                // without exposing coordinator internals or sampling resolution from Task.
                yield* Effect.yieldNow
                yield* Deferred.succeed(resultEntered, undefined)
                return yield* Fiber.join(pending)
              })
            },
          }
          owner.scope = instrumented
          wrapped.set(scope.sessionID, instrumented)
          return instrumented
        }

        const instrumentedAttachments: AttachmentCoordinator.Interface = {
          ...boot.attachments,
          open: (sessionID) => boot.attachments.open(sessionID).pipe(Effect.map(wrap)),
          locate: (sessionID) =>
            boot.attachments
              .locate(sessionID)
              .pipe(Effect.map((scope) => (scope ? (wrapped.get(sessionID) ?? scope) : scope))),
          locateBorrowable: (sessionID) =>
            boot.attachments
              .locateBorrowable(sessionID)
              .pipe(Effect.map((scope) => (scope ? (wrapped.get(sessionID) ?? scope) : scope))),
        }

        const exactWaits: Array<{
          readonly blocking: boolean
          readonly handle: BackgroundJob.InvocationHandle
          readonly status: BackgroundJob.Info["status"] | undefined
        }> = []
        waitHandleHook = (input, status) => {
          exactWaits.push({ blocking: input.timeout === undefined, handle: input.handle, status })
        }

        const deliveries: string[] = []
        let childRuns = 0
        const ops: TaskPromptOps = {
          ...boot.capture.ops,
          attachments: instrumentedAttachments,
          prompt: (input) =>
            Effect.gen(function* () {
              if (input.sessionID === boot.caller.id) {
                deliveries.push(injectedText(input.parts))
                yield* Deferred.succeed(delivered, undefined)
                return acknowledged(boot.caller.id)
              }

              childRuns++
              if (childRuns === 1) {
                if (!input.attachmentScope) return yield* Effect.die("K14 owner run had no attachment scope")
                // Registered attachment with no observer/wake: it keeps the first result parked while
                // leaving the cancellation/degradation discriminator at active=0, wakes=0.
                yield* input.attachmentScope.reserve(SessionID.create())
                return yield* boot.capture.ops.prompt(input)
              }
              if (childRuns !== 2) return yield* Effect.die("unexpected K14 child run")
              // Production `promptAdmitted` owns the later User BEFORE invoking this callback. Hold
              // here so the scope slots are invalidated but no later Assistant can hide the retained
              // fallback or change the low-level last-Assistant result.
              return yield* boot.capture.ops.prompt({
                ...input,
                onAdmitted: (input.onAdmitted ?? Effect.void).pipe(
                  Effect.andThen(Deferred.succeed(laterOwned, undefined)),
                  Effect.andThen(
                    terminal === "error"
                      ? Effect.die(new Error("K14 confusable terminal error"))
                      : Deferred.await(releaseAdmission),
                  ),
                ),
              })
            }),
        }

        yield* boot.llm.text(earlierText)

        const base = withOps(boot.capture.context, ops)
        const caller: Tool.Context = {
          ...base,
          extra: { ...base.extra, promptOps: ops, attachment: parent },
        }
        const receipt = yield* boot.task.execute(
          { description: `K14 ${terminal}`, prompt: "first", subagent_type: "general", async: true },
          caller,
        )
        const child = SessionID.make(receipt.metadata.sessionId)
        yield* Deferred.await(resultEntered)

        const scope = owner.scope
        const earlier = owner.earlier
        if (!scope || !earlier) return yield* Effect.die("K14 owner scope did not enter its first result")
        expect(earlier.parts.findLast((part) => part.type === "text")?.text).toBe(earlierText)
        expect(scope.current()).toMatchObject({ attached: 1, candidate: true, failed: false, cancelled: false })
        expect(activity).toEqual({ active: 0, wakes: 0 })
        expect(yield* Deferred.isDone(firstResultDone)).toBe(false)

        const supplement = yield* boot.task.execute(
          { description: `K14 ${terminal} later`, prompt: "later", subagent_type: "general", task_id: child },
          caller,
        )
        expect(supplement.output).toContain("task updated")
        yield* Deferred.await(laterOwned)

        // The later production ownership invalidated candidate/observed. Only the first clean turn
        // ever observed evidence, so observed is empty by construction; no observer or wake touched
        // this owner scope, making the gate precondition explicit in both repaired and mutant runs.
        expect(scope.current().candidate).toBe(false)
        expect(activity).toEqual({ active: 0, wakes: 0 })

        if (terminal === "cancelled") {
          const lookup = boot.sessions
            .findMessage(child, (message) => message.info.role !== "user")
            .pipe(Effect.orDie, Effect.map(Option.getOrThrow))
          const before = acquired.filter(
            (item) => item.session === child && item.source === "SessionRunState.ensureRunning",
          ).length
          // A real Runner in the same production SessionRunState store uses the exact lookup from
          // SessionPrompt.lastAssistant. The later Task prompt is held after own/before Runner, so
          // cancellation must return the earlier successful Assistant, not a fixture-created value.
          const runner = yield* boot.runState.ensureRunning(child, lookup, Effect.never).pipe(Effect.forkChild)
          yield* Effect.yieldNow
          expect(
            acquired.filter((item) => item.session === child && item.source === "SessionRunState.ensureRunning"),
          ).toHaveLength(before + 1)
          expect(yield* boot.runState.listActive()).toContainEqual({ session: child, running: true, shell: false })

          yield* boot.runState.cancel(child)
          const lowLevel = yield* Fiber.join(runner)
          expect(lowLevel.info.id).toBe(earlier.info.id)
          expect(lowLevel.parts.findLast((part) => part.type === "text")?.text).toBe(earlierText)
        }

        const waited = yield* boot.jobs.wait({ id: child, timeout: 10_000 })
        expect(waited.timedOut).toBe(false)
        expect(waited.info?.status).toBe(terminal)
        expect(waited.info?.output).toBeUndefined()

        // SAME Assistant ID, deliberately. A fresh probe would be uncovered Admission Freshness and
        // could hide the Exit.void bug by returning its own clean evidence.
        const selected = yield* scope.result(earlier)
        const selectedBytes = JSON.stringify(selected)
        if (terminal === "cancelled") {
          expect(selected).toMatchObject({ type: "cancelled" })
          expect("fallback" in selected).toBe(false)
          expect(selectedBytes).not.toContain(earlierText)
          expect(selectedBytes).not.toContain(earlier.info.id)
        } else {
          expect(selected).toMatchObject({ type: "evidence", degraded: true })
          if (selected.type !== "evidence") return yield* Effect.die("error terminal collapsed into cancellation")
          expect(selected.fallback.info.id).toBe(earlier.info.id)
          expect(selected.fallback.parts.findLast((part) => part.type === "text")?.text).toBe(earlierText)
        }

        yield* Deferred.await(delivered)
        expect(deliveries).toHaveLength(1)
        const envelope = deliveries[0] ?? ""
        expect(envelope).toContain(`state="${terminal}"`)
        expect(envelope).not.toContain(earlierText)
        expect(envelope).not.toContain(earlier.info.id)
        if (terminal === "cancelled") {
          expect(envelope).toContain("status: unknown")
          expect(envelope).toContain(`task_evidence=${JSON.stringify({ task_id: child, status: "unknown" })}`)
          expect(envelope.split("task_evidence=").length - 1).toBe(1)
          expect(envelope).not.toContain("status: cancelled")
          expect(envelope).not.toContain('state="error"')
          expect(envelope).not.toContain("Task failed")
        }
        if (terminal === "error") expect(envelope).toContain("K14 confusable terminal error")

        const blocking = exactWaits.filter((item) => item.blocking)
        expect(blocking).toHaveLength(2)
        expect(blocking.every((item) => item.status === terminal)).toBe(true)
        expect(blocking[1]?.handle).toEqual(blocking[0]?.handle)
        expect(yield* Deferred.isDone(firstResultDone)).toBe(true)
        yield* Deferred.succeed(releaseAdmission, undefined)
        yield* parent.close()
      })

    background.instance(
      "K14: exact cancelled terminal clears the retained fallback at the production Runner seam",
      () => terminalProjection("cancelled"),
      instance,
    )

    background.instance(
      "K14 control: exact error terminal degrades and retains truthful fallback evidence",
      () => terminalProjection("error"),
      instance,
    )
  })
})
