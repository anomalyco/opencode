import { afterEach, describe, expect } from "bun:test"
import { NodeHttpServer, NodeServices } from "@effect/platform-node"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { EventV2 } from "@opencode-ai/core/event"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"
import type { SessionV1 } from "@opencode-ai/core/v1/session"
import { Config, Deferred, Effect, Exit, Fiber, Layer, Queue, Schema, Sink, Stream } from "effect"
import { HttpClient, HttpClientRequest, HttpRouter, HttpServer } from "effect/unstable/http"
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process"
import { layerWebSocketConstructorGlobal } from "effect/unstable/socket/Socket"
import path from "node:path"
import { BackgroundJob } from "@/background/job"
import { Command } from "@/command"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { Plugin } from "@/plugin"
import { AttachmentCoordinator } from "@/session/attachment/coordinator"
import { SessionCompaction } from "@/session/compaction"
import { SessionClosure } from "@/session/closure/coordinator"
import { SessionClosureModel as Model } from "@/session/closure/model"
import { SessionClosurePorts as Ports } from "@/session/closure/ports"
import { SessionPhysical } from "@/session/physical-interrupt"
import { SessionRevert } from "@/session/revert"
import { MessageID, SessionID } from "@/session/schema"
import { Session } from "@/session/session"
import { renderOutput } from "@/session/task-return"
import { SessionToolPartPermit } from "@/session/toolpart-permit"
import { HttpApiApp } from "@/server/routes/instance/httpapi/server"
import { TaskTool, type TaskPromptOps } from "@/tool/task"
import { ToolRegistry } from "@/tool/registry"
import * as Tool from "@/tool/tool"
import { disposeAllInstances, TestInstance } from "../fixture/fixture"
import { awaitWithTimeout, pollWithTimeout, testEffect } from "../lib/effect"
import { TestLLMServer } from "../lib/llm-server"
import { testProviderConfig } from "../lib/test-provider"

// CP-023 Gate 5 G4a/G4b — the NAMED HTTP consumers and mid-setup owners behind the generic release
// proof in closure-driver.test.ts. This file uses the real coordinator, real SessionAdmission and
// real SessionPrompt/HTTP graph. Its tiny driver only returns verified PairPermits: G1 already proves
// the real Message/Part writer and postflight. G4a proves post-fence consumers park until the SAME
// production release.commit wakes them; G4b proves a landing fence reaches already-running pre-bind
// command/shell setup and that the lease settles before that real release removes the fence.

type HeldRun = { readonly input: Ports.DriverRun; readonly release: Deferred.Deferred<void> }
type StandingFence = {
  readonly closure: SessionClosure.Interface
  readonly operation: Model.OperationID
  readonly root: Model.SessionID
  readonly view: Model.ViewID
  readonly run: HeldRun
  readonly request: Fiber.Fiber<SessionClosure.Outcome, SessionClosure.Failure | Ports.LocationError>
}
type CleanupPause = {
  readonly session: SessionID
  readonly entered: Deferred.Deferred<void>
  readonly blocked: Deferred.Deferred<void>
}
type TemplatePause = {
  readonly name: string
  readonly entered: Deferred.Deferred<void>
  readonly template: Promise<string>
}
type BindPause = {
  readonly session: SessionID
  readonly entered: Deferred.Deferred<void>
  readonly blocked: Deferred.Deferred<void>
}

const runs: { queue?: Queue.Queue<HeldRun> } = {}
const captured: { closure?: SessionClosure.Interface } = {}
const trace: string[] = []
const lookups: string[] = []
const expansions: string[] = []
const pluginCalls: string[] = []
const commandTemplates = new Map<string, string>()
const binds: Array<{ readonly lease: Model.LeaseID; readonly owner: Model.AdmissionOwner }> = []
const retirements: Model.LeaseID[] = []
const dispositions: Array<{ readonly lease: Model.LeaseID; readonly disposition: SessionClosure.LeaseDisposition }> = []
const admissions: Array<{
  readonly input: SessionClosure.AcquireInput
  readonly decision: SessionClosure.Admission
}> = []
let cleanupPause: CleanupPause | undefined
let templatePause: TemplatePause | undefined
let bindPause: BindPause | undefined
let spawnCapture: { readonly match: string; readonly commands: string[] } | undefined
let taskCapture: { readonly ops: TaskPromptOps; readonly context: Tool.Context } | undefined
let taskDefinition: Tool.InferDef<typeof TaskTool> | undefined
let taskSessions: Session.Interface | undefined
let taskJobs: BackgroundJob.Interface | undefined

const runState: Ports.RunStateCapability = {
  assertNotBusy: () => Effect.void,
  cancel: () => Effect.void,
}

const command = <T extends Model.Command["type"]>(step: Model.Step, type: T) => {
  const found = step.commands.find((item): item is Extract<Model.Command, { readonly type: T }> => item.type === type)
  if (!found) throw new Error(`Missing SessionClosure command: ${type}`)
  return found
}

const operation = (view: Model.View, operationID: Model.OperationID) => {
  const current = view.operations.find((item) => item.id === operationID)
  if (!current) throw new Error(`Missing SessionClosure operation: ${operationID}`)
  return current
}

const driver: Ports.Driver = {
  run: (input) =>
    Effect.gen(function* () {
      const release = yield* Deferred.make<void>()
      yield* Queue.offer(runs.queue!, { input, release })
      yield* Deferred.await(release)
    }),
  command: (input) => {
    if (input.command.type !== "pair.write") return Effect.void
    return input.control
      .transition({ type: "pair.return", write: input.command, message: "verified", part: "verified" })
      .pipe(Effect.orDie, Effect.asVoid)
  },
}

const ports = Ports.makeLayer(() => Effect.succeed({ driver, participants: [], hooks: {} }))
const capturingClosure = Layer.effect(
  SessionClosure.Service,
  Effect.gen(function* () {
    const service = yield* SessionClosure.Service
    const wrapped = SessionClosure.Service.of({
      ...service,
      acquire: (input) =>
        service
          .acquire(input)
          .pipe(Effect.tap((decision) => Effect.sync(() => void admissions.push({ input, decision })))),
      bind: (lease, owner) =>
        Effect.gen(function* () {
          const pause = bindPause
          if (pause && owner.type === "scope" && owner.id === Model.id("scope", `shell:${pause.session}`)) {
            yield* Deferred.succeed(pause.entered, undefined)
            yield* Deferred.await(pause.blocked)
          }
          binds.push({ lease, owner })
          yield* service.bind(lease, owner)
        }),
      retire: (lease, disposition) =>
        Effect.sync(() => {
          retirements.push(lease)
          dispositions.push({ lease, disposition: disposition ?? "retired" })
        }).pipe(Effect.andThen(service.retire(lease, disposition))),
    })
    captured.closure = wrapped
    return wrapped
  }),
).pipe(Layer.provide(SessionClosure.layer))
const capturingClosureNode = LayerNode.make({
  service: SessionClosure.Service,
  layer: capturingClosure,
  deps: [Ports.node, SessionToolPartPermit.node],
})

const commandInfo = (name: string): Command.Info => ({
  name,
  source: "command",
  hints: [],
  get template() {
    expansions.push(name)
    const pause = templatePause
    if (pause?.name === name) {
      Effect.runSync(Deferred.succeed(pause.entered, undefined).pipe(Effect.ignore))
      return pause.template
    }
    return commandTemplates.get(name) ?? `${name} body`
  },
})
const commands = Layer.succeed(
  Command.Service,
  Command.Service.of({
    get: (name) =>
      Effect.sync(() => {
        lookups.push(name)
        return commandInfo(name)
      }),
    list: () => Effect.succeed([commandInfo("probe"), commandInfo(Command.Default.INIT)]),
  }),
)

const revert = Layer.succeed(
  SessionRevert.Service,
  SessionRevert.Service.of({
    revert: () => Effect.die("unused revert"),
    unrevert: () => Effect.die("unused unrevert"),
    cleanup: (session) =>
      Effect.gen(function* () {
        trace.push("cleanup:start")
        const pause = cleanupPause
        if (pause?.session === session.id) {
          yield* Deferred.succeed(pause.entered, undefined)
          yield* Deferred.await(pause.blocked)
        }
        trace.push("cleanup:end")
      }),
  }),
)

const compaction = Layer.succeed(
  SessionCompaction.Service,
  SessionCompaction.Service.of({
    isOverflow: () => Effect.succeed(false),
    prune: () => Effect.void,
    process: () => Effect.die("unused process"),
    create: () => Effect.sync(() => void trace.push("compact")),
  }),
)

const plugins = Layer.succeed(
  Plugin.Service,
  Plugin.Service.of({
    trigger: (name, _input, output) =>
      Effect.sync(() => {
        pluginCalls.push(name)
        return output
      }),
    list: () => Effect.succeed([]),
    init: () => Effect.void,
  }),
)

const spawner = Layer.effect(
  ChildProcessSpawner.ChildProcessSpawner,
  Effect.gen(function* () {
    const real = yield* ChildProcessSpawner.ChildProcessSpawner
    return ChildProcessSpawner.make((child) => {
      const current = spawnCapture
      if (!current) return real.spawn(child)
      const command = ChildProcess.isStandardCommand(child) ? child : undefined
      const text = [command?.command ?? child._tag, ...(command?.args ?? [])].join(" ")
      if (!text.includes(current.match)) return real.spawn(child)
      current.commands.push(text)
      return Effect.succeed(
        ChildProcessSpawner.makeHandle({
          pid: ChildProcessSpawner.ProcessId(0),
          exitCode: Effect.succeed(ChildProcessSpawner.ExitCode(0)),
          isRunning: Effect.succeed(false),
          kill: () => Effect.void,
          stdin: Sink.drain,
          stdout: Stream.empty,
          stderr: Stream.empty,
          all: Stream.empty,
          getInputFd: () => Sink.drain,
          getOutputFd: () => Stream.empty,
          unref: Effect.succeed(Effect.void),
        }),
      )
    })
  }),
).pipe(Layer.provide(AppNodeBuilder.build(CrossSpawnSpawner.node)))

const TaskCaptureParameters = Schema.Struct({})
const taskCaptureTool: Tool.Def<typeof TaskCaptureParameters> = {
  id: "capture-k70",
  description: "Capture production Task prompt capabilities for the K70 notifier test.",
  parameters: TaskCaptureParameters,
  execute: (_args, ctx) =>
    Effect.sync(() => {
      const ops = ctx.extra?.promptOps as TaskPromptOps | undefined
      if (!ops) throw new Error("K70 capture tool did not receive TaskPromptOps")
      taskCapture = { ops, context: ctx }
      return { title: "captured", metadata: {}, output: "captured" }
    }),
}

const taskRegistry = Layer.effect(
  ToolRegistry.Service,
  Effect.gen(function* () {
    taskSessions = yield* Session.Service
    taskJobs = yield* BackgroundJob.Service
    const info = yield* TaskTool
    const definition = yield* info.init()
    taskDefinition = { id: info.id, ...definition }
    return ToolRegistry.Service.of({
      ids: () => Effect.succeed([taskCaptureTool.id, info.id]),
      all: () => Effect.succeed([taskCaptureTool, taskDefinition!]),
      named: () => Effect.die("unused named tools"),
      tools: () => Effect.succeed([taskCaptureTool, taskDefinition!]),
    })
  }),
)
const taskRegistryNode = LayerNode.make({
  service: ToolRegistry.Service,
  layer: taskRegistry,
  deps: [LayerNode.group(ToolRegistry.node.dependencies)],
})

const commonReplacements = [
  [Ports.node, ports],
  [SessionClosure.node, capturingClosureNode],
  [Command.node, commands],
  [Plugin.node, plugins],
  [CrossSpawnSpawner.node, spawner],
] as const satisfies LayerNode.Replacements
const replacements = [
  ...commonReplacements,
  [SessionRevert.node, revert],
  [SessionCompaction.node, compaction],
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

const taskReplacements = [
  ...replacements,
  [ToolRegistry.node, taskRegistryNode],
  [RuntimeFlags.node, RuntimeFlags.layer({ experimentalBackgroundSubagents: true })],
] as const satisfies LayerNode.Replacements
const taskServed: Layer.Layer<never, Config.ConfigError, HttpServer.HttpServer> = HttpRouter.serve(
  HttpApiApp.createRoutes(undefined, taskReplacements),
  { disableListenLog: true, disableLogger: true },
)
const taskHttp = taskServed.pipe(
  Layer.provide(layerWebSocketConstructorGlobal),
  Layer.provideMerge(NodeHttpServer.layerTest),
  Layer.provideMerge(NodeServices.layer),
)
const taskIt = testEffect(Layer.mergeAll(taskHttp, TestLLMServer.layer))

// The release-seam fixtures above replace compaction and revert so they can pause exact setup
// boundaries. Attachment ingress needs the opposite topology: retain the command/plugin/process
// instruments and Task capability capture, but run the real cleanup and compaction writers.
const attachmentReplacements = [
  ...commonReplacements,
  [ToolRegistry.node, taskRegistryNode],
  [RuntimeFlags.node, RuntimeFlags.layer({ experimentalBackgroundSubagents: true })],
] as const satisfies LayerNode.Replacements
const attachmentServed: Layer.Layer<never, Config.ConfigError, HttpServer.HttpServer> = HttpRouter.serve(
  HttpApiApp.createRoutes(undefined, attachmentReplacements),
  { disableListenLog: true, disableLogger: true },
)
const attachmentHttp = attachmentServed.pipe(
  Layer.provide(layerWebSocketConstructorGlobal),
  Layer.provideMerge(NodeHttpServer.layerTest),
  Layer.provideMerge(NodeServices.layer),
)
const attachmentIt = testEffect(Layer.mergeAll(attachmentHttp, TestLLMServer.layer))

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

const create = (directory: string) =>
  request("/session", directory, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ title: "Pinned" }),
  }).pipe(
    Effect.flatMap((response) => response.json),
    Effect.map((value) => value as { id: SessionID }),
  )

const messages = (directory: string, session: SessionID) =>
  request(`/session/${session}/message`, directory).pipe(
    Effect.flatMap((response) => response.json),
    Effect.map((value) => value as SessionV1.WithParts[]),
  )

const sessionInfo = (directory: string, session: SessionID) =>
  request(`/session/${session}`, directory).pipe(
    Effect.flatMap((response) => response.json),
    Effect.map((value) => value as Session.Info),
  )

const post = (directory: string, urlPath: string, body: object) =>
  request(urlPath, directory, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })

const bootstrapTask = Effect.gen(function* () {
  const test = yield* TestInstance
  const llm = yield* TestLLMServer
  const caller = yield* create(test.directory)
  yield* llm.tool(taskCaptureTool.id, {})
  yield* llm.text("capture complete")
  const response = yield* post(test.directory, `/session/${caller.id}/message`, {
    agent: "build",
    model: { providerID: "test", modelID: "test-model" },
    parts: [{ type: "text", text: "capture Task capabilities" }],
  })
  if (response.status !== 200)
    return yield* Effect.die(new Error(`K70 Task bootstrap failed (${response.status}): ${yield* response.text}`))
  if (!taskCapture || !taskDefinition || !taskSessions || !taskJobs)
    return yield* Effect.die("K70 Task graph did not expose its production capabilities")
  return {
    test,
    llm,
    caller,
    capture: taskCapture,
    task: taskDefinition,
    sessions: taskSessions,
    jobs: taskJobs,
  }
})

const startAttachedRunner = Effect.fn("ClosureHttpReleaseSeams.startAttachedRunner")(function* (title: string) {
  const boot = yield* bootstrapTask
  const target = yield* boot.sessions.create({ title })
  const scope = yield* boot.capture.ops.attachments.open(target.id)

  const release = yield* Deferred.make<void>()
  yield* Effect.addFinalizer(() =>
    Deferred.succeed(release, undefined).pipe(
      Effect.andThen(scope.claimCancellation("cancelled")),
      Effect.andThen(scope.close()),
      Effect.andThen(boot.capture.ops.physical.interruptExact({ type: "session", session: target.id })),
      Effect.ignore,
    ),
  )

  const calls = yield* boot.llm.calls
  yield* boot.llm.hold("attached turn complete", Effect.runPromise(Deferred.await(release)))
  const running = yield* boot.capture.ops
    .prompt({
      sessionID: target.id,
      agent: "build",
      model: { providerID: ProviderV2.ID.make("test"), modelID: ModelV2.ID.make("test-model") },
      attachmentScope: scope,
      parts: [{ type: "text", text: "active delegated turn" }],
    })
    .pipe(Effect.forkScoped)
  yield* boot.llm.wait(calls + 1)
  // `TestLLMServer.wait` proves that the request reached the server, not that the Runner consumed
  // the response head. The head emits `start-step` before the held tail; take the comparison
  // baseline only after that durable Part exists so an unrelated side-operation cannot lose a race
  // with the active Runner and appear to have mutated its transcript.
  const baseline = yield* pollWithTimeout(
    messages(boot.test.directory, target.id).pipe(
      Effect.map((rows) =>
        rows.some((row) => row.info.role === "assistant" && row.parts.some((part) => part.type === "step-start"))
          ? rows
          : undefined,
      ),
    ),
    `attached Runner ${target.id} did not persist its step-start before baseline capture`,
  )
  expect(baseline.some((row) => row.info.role === "user")).toBe(true)
  expect(scope.current().failed).toBe(false)
  return { ...boot, target, scope, release, running, baseline }
})

const finishAttachedRunner = (active: Effect.Success<ReturnType<typeof startAttachedRunner>>) =>
  Deferred.succeed(active.release, undefined).pipe(
    Effect.andThen(
      awaitWithTimeout(
        Fiber.await(active.running),
        `attached Runner ${active.target.id} did not settle after its provider was released`,
        "10 seconds",
      ),
    ),
  )

const taskContext = (base: Tool.Context, session: SessionID, message: MessageID, ops: TaskPromptOps): Tool.Context => ({
  ...base,
  sessionID: session,
  messageID: message,
  abort: new AbortController().signal,
  // K70 is the feature-off/plain notifier. Omitting an attachment scope is what routes the real
  // TaskTool through `attach -> notify -> acquireContinuation`; the attached path has independent
  // CP-021 accounting and is deliberately not this row.
  extra: { promptOps: ops },
})

const seedTaskAssistant = (service: Session.Interface, session: SessionID, directory: string) =>
  Effect.gen(function* () {
    const providerID = ProviderV2.ID.make("test")
    const modelID = ModelV2.ID.make("test-model")
    const user = yield* service.updateMessage({
      id: MessageID.ascending(),
      role: "user",
      sessionID: session,
      agent: "build",
      model: { providerID, modelID },
      time: { created: Date.now() },
    })
    const assistant: SessionV1.Assistant = {
      id: MessageID.ascending(),
      role: "assistant",
      parentID: user.id,
      sessionID: session,
      mode: "build",
      agent: "build",
      cost: 0,
      path: { cwd: directory, root: directory },
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      providerID,
      modelID,
      time: { created: Date.now() },
    }
    yield* service.updateMessage(assistant)
    return assistant.id
  })

const standFence = (session: SessionID) =>
  Effect.gen(function* () {
    const closure = captured.closure
    if (!closure) return yield* Effect.die("the composed coordinator was never captured")
    const pending = yield* closure.request({ root: session, runState }).pipe(Effect.forkScoped)
    const run = yield* Queue.take(runs.queue!)
    const root = Model.id("session", session)
    const before = operation(yield* closure.view, run.input.command.operation)
    const rootView = before.views.find((item) => item.root === root)
    if (!rootView) return yield* Effect.die("closure request omitted its root view")
    const claimed = yield* run.input.control.claim({
      operation: before.id,
      proofs: [{ value: "proven_connected", root, active: root, path: [root], edges: [] }],
      signals: [Effect.succeed("success" as const)],
    })
    expect(claimed.decision).toEqual({ type: "applied" })
    expect((yield* closure.view).fences.map((item) => item.session)).toEqual([root])
    return { closure, operation: before.id, root, view: rootView.id, run, request: pending } satisfies StandingFence
  })

const writeAll = (fence: StandingFence): Effect.Effect<void, Ports.LocationError> =>
  Effect.gen(function* () {
    const next = yield* fence.run.input.control.transition({ type: "writer.next", operation: fence.operation })
    if (!next.commands.some((item) => item.type === "pair.candidate")) return
    yield* writeAll(fence)
  })

const prepareQuiescence = (fence: StandingFence) =>
  Effect.gen(function* () {
    const control = fence.run.input.control
    yield* control.transition({
      type: "view.require",
      operation: fence.operation,
      view: fence.view,
      nodes: [fence.root],
      facts: [{ type: "root", root: fence.root, direct: { outcome: "cancelled", yielded: false } }],
    })
    yield* control.transition({ type: "operation.advance", operation: fence.operation, to: { type: "fencing" } })
    yield* control.transition({ type: "operation.advance", operation: fence.operation, to: { type: "quiescing" } })
  })

const proveQuiescence = (fence: StandingFence) =>
  Effect.gen(function* () {
    const control = fence.run.input.control
    const prior = yield* control.scan(fence.operation)
    const current = yield* control.scan(fence.operation)
    return yield* control.transition({ type: "quiescence.prove", operation: fence.operation, prior, current })
  })

const commitRelease = (fence: StandingFence, label: string) =>
  Effect.gen(function* () {
    const control = fence.run.input.control
    const begun = yield* control.transition({ type: "planning.begin", operation: fence.operation })
    const read = command(begun, "plan.read")
    const planned = operation(yield* fence.closure.view, fence.operation)
    const returned = yield* control.transition({
      type: "planning.return",
      read,
      identities: read.targets.map((session) => ({
        session,
        identity: {
          source: "session_identity" as const,
          agent: "gate5-release-seam",
          model: { providerID: "test", modelID: "test-model", variant: { present: false as const } },
        },
      })),
      seed: {
        clockMillis: 2_000,
        highWaterMillis: 1_000,
        coordinates: planned.facts.map((fact, index) => ({
          fact: fact.id,
          message: Model.id("message", `msg_${label}_${index}`),
          part: Model.id("part", `prt_${label}_${index}`),
          messageEvent: Model.id("event", `evt_${label}_${index}_message`),
          partEvent: Model.id("event", `evt_${label}_${index}_part`),
        })),
      },
    })
    expect(returned.decision.type).toBe("applied")
    yield* writeAll(fence)
    const prepared = yield* control.transition({ type: "release.prepare", operation: fence.operation })
    const check = command(prepared, "release.verify")
    const committed = yield* control.transition({ type: "release.commit", check })
    expect(committed.decision.type).toBe("applied")
    expect((yield* fence.closure.view).fences.some((item) => item.session === fence.root)).toBe(false)
    yield* Deferred.succeed(fence.run.release, undefined)
    return yield* Fiber.join(fence.request).pipe(Effect.exit)
  })

const release = (fence: StandingFence, label: string) =>
  Effect.gen(function* () {
    yield* prepareQuiescence(fence)
    const proved = yield* proveQuiescence(fence)
    expect(proved.decision.type).toBe("applied")
    return yield* commitRelease(fence, label)
  })

const joined = (fence: StandingFence, source: string) =>
  pollWithTimeout(
    fence.closure.view.pipe(
      Effect.map((view) =>
        view.leases.find(
          (item) =>
            item.source === source &&
            item.session === fence.root &&
            item.acquisition === "post_fence" &&
            item.operation,
        ),
      ),
    ),
    `${source} never joined the standing fence`,
  )

afterEach(async () => {
  captured.closure = undefined
  cleanupPause = undefined
  trace.length = 0
  lookups.length = 0
  expansions.length = 0
  pluginCalls.length = 0
  commandTemplates.clear()
  binds.length = 0
  retirements.length = 0
  dispositions.length = 0
  admissions.length = 0
  templatePause = undefined
  bindPause = undefined
  spawnCapture = undefined
  taskCapture = undefined
  taskDefinition = undefined
  taskSessions = undefined
  taskJobs = undefined
  await disposeAllInstances()
})

describe("named HTTP seams across Gate-5 release", () => {
  it.instance(
    "K36: HTTP prompt parks without Message/provider/permission effects, then retries once after release, including noReply",
    () =>
      Effect.gen(function* () {
        runs.queue = yield* Queue.unbounded<HeldRun>()
        const test = yield* TestInstance
        const llm = yield* TestLLMServer
        const promptBody = (text: string, noReply: boolean) => ({
          agent: "build",
          model: { providerID: "test", modelID: "test-model" },
          noReply,
          tools: { bash: false },
          parts: [{ type: "text", text }],
        })

        // Positive controls: the exact HTTP graph records both noReply transcript work and the
        // ordinary provider path when unfenced. The zeroes below therefore cannot come from a dead
        // route, inert row reader, or uncounted provider.
        const noReplyControl = yield* create(test.directory)
        expect(yield* messages(test.directory, noReplyControl.id)).toHaveLength(0)
        const noReplyResponse = yield* post(
          test.directory,
          `/session/${noReplyControl.id}/message`,
          promptBody("noReply control", true),
        )
        expect(noReplyResponse.status).toBe(200)
        expect(yield* messages(test.directory, noReplyControl.id)).toHaveLength(1)
        expect((yield* sessionInfo(test.directory, noReplyControl.id)).permission).toEqual([
          { permission: "bash", action: "deny", pattern: "*" },
        ])

        const providerControl = yield* create(test.directory)
        yield* llm.text("provider control")
        const controlCalls = yield* llm.calls
        const providerResponse = yield* post(
          test.directory,
          `/session/${providerControl.id}/message`,
          promptBody("provider control", false),
        )
        expect(providerResponse.status).toBe(200)
        expect((yield* llm.calls) - controlCalls).toBe(1)

        const blockedNoReply = yield* create(test.directory)
        trace.length = 0
        const noReplyFence = yield* standFence(blockedNoReply.id)
        const waitingNoReply = yield* post(
          test.directory,
          `/session/${blockedNoReply.id}/message`,
          promptBody("released noReply", true),
        ).pipe(Effect.forkScoped)
        const noReplyLease = yield* joined(noReplyFence, "SessionPrompt.prompt")
        expect(noReplyLease.state).toBe("reserved")
        expect(yield* messages(test.directory, blockedNoReply.id)).toHaveLength(0)
        expect(Object.hasOwn(yield* sessionInfo(test.directory, blockedNoReply.id), "permission")).toBe(false)
        expect(trace).toEqual([])

        yield* release(noReplyFence, "k36_no_reply")
        expect((yield* Fiber.join(waitingNoReply)).status).toBe(200)
        const noReplyRows = yield* messages(test.directory, blockedNoReply.id)
        expect(noReplyRows).toHaveLength(1)
        expect(noReplyRows[0]?.parts).toHaveLength(1)
        expect((yield* sessionInfo(test.directory, blockedNoReply.id)).permission).toEqual([
          { permission: "bash", action: "deny", pattern: "*" },
        ])
        const noReplyAfter = (yield* noReplyFence.closure.view).leases.filter(
          (item) => item.source === "SessionPrompt.prompt" && item.session === noReplyFence.root,
        )
        expect(noReplyAfter).toEqual([])
        expect(dispositions.filter((item) => item.lease === noReplyLease.id)).toEqual([
          { lease: noReplyLease.id, disposition: "retired" },
        ])

        const blockedProvider = yield* create(test.directory)
        trace.length = 0
        const providerFence = yield* standFence(blockedProvider.id)
        yield* llm.text("released provider")
        const blockedCalls = yield* llm.calls
        const waitingProvider = yield* post(
          test.directory,
          `/session/${blockedProvider.id}/message`,
          promptBody("released provider", false),
        ).pipe(Effect.forkScoped)
        yield* joined(providerFence, "SessionPrompt.prompt")
        expect(yield* messages(test.directory, blockedProvider.id)).toHaveLength(0)
        expect((yield* llm.calls) - blockedCalls).toBe(0)
        expect(trace).toEqual([])

        yield* release(providerFence, "k36_provider")
        expect((yield* Fiber.join(waitingProvider)).status).toBe(200)
        expect((yield* llm.calls) - blockedCalls).toBe(1)
        expect(yield* messages(test.directory, blockedProvider.id)).toHaveLength(2)
      }),
    instance,
  )

  // The reference's promptAsync cleanup-preflight case is omitted because this target has no
  // `preflightOnly` cleanup seam.
  it.instance(
    "K37: HTTP command and init perform zero expansion while parked and exactly one after their one retry",
    () =>
      Effect.gen(function* () {
        runs.queue = yield* Queue.unbounded<HeldRun>()
        const test = yield* TestInstance
        const llm = yield* TestLLMServer
        const cases = [
          {
            label: "command",
            name: "probe",
            path: (session: SessionID) => `/session/${session}/command`,
            body: () => ({ command: "probe", arguments: "", agent: "build", model: "test/test-model" }),
          },
          {
            label: "init",
            name: Command.Default.INIT,
            path: (session: SessionID) => `/session/${session}/init`,
            body: () => ({ providerID: "test", modelID: "test-model", messageID: MessageID.ascending() }),
          },
        ] as const

        yield* Effect.forEach(cases, (item) =>
          Effect.gen(function* () {
            // Positive control through the same HTTP endpoint and the same lazy-template instrument.
            const control = yield* create(test.directory)
            lookups.length = 0
            expansions.length = 0
            yield* llm.text(`${item.label} control`)
            const controlCalls = yield* llm.calls
            const controlResponse = yield* post(test.directory, item.path(control.id), item.body())
            if (controlResponse.status !== 200)
              return yield* Effect.die(
                new Error(
                  `${item.label} control failed (${controlResponse.status}): ${yield* controlResponse.text}; lookups=${lookups.join(",")}; expansions=${expansions.join(",")}`,
                ),
              )
            expect(controlResponse.status).toBe(200)
            expect(lookups).toEqual([item.name])
            expect(expansions).toEqual([item.name])
            expect((yield* llm.calls) - controlCalls).toBe(1)

            const blocked = yield* create(test.directory)
            lookups.length = 0
            expansions.length = 0
            const fence = yield* standFence(blocked.id)
            yield* llm.text(`${item.label} released`)
            const calls = yield* llm.calls
            const waiting = yield* post(test.directory, item.path(blocked.id), item.body()).pipe(Effect.forkScoped)
            const lease = yield* joined(fence, "SessionPrompt.command")

            // Command lookup is the documented read-only precondition and is intentionally before
            // admission. Template resolution/expansion and provider work are behind the wait.
            expect(lease.state).toBe("reserved")
            expect(lookups).toEqual([item.name])
            expect(expansions).toEqual([])
            expect((yield* llm.calls) - calls).toBe(0)
            expect(yield* messages(test.directory, blocked.id)).toHaveLength(0)

            yield* release(fence, `k37_${item.label}`)
            expect((yield* Fiber.join(waiting)).status).toBe(200)
            expect(lookups).toEqual([item.name])
            expect(expansions).toEqual([item.name])
            expect((yield* llm.calls) - calls).toBe(1)
            const after = (yield* fence.closure.view).leases.filter(
              (candidate) => candidate.source === "SessionPrompt.command" && candidate.session === fence.root,
            )
            expect(after).toEqual([])
            expect(dispositions.filter((entry) => entry.lease === lease.id)).toEqual([
              { lease: lease.id, disposition: "retired" },
            ])
          }),
        )
      }),
    instance,
  )

  it.instance(
    "K55: a fence landing mid-summarize interrupts before compact/provider; a fresh post-release summarize runs once",
    () =>
      Effect.gen(function* () {
        runs.queue = yield* Queue.unbounded<HeldRun>()
        const test = yield* TestInstance
        const llm = yield* TestLLMServer
        const summarize = (session: SessionID) =>
          post(test.directory, `/session/${session}/summarize`, { providerID: "test", modelID: "test-model" })
        const seed = (session: SessionID) =>
          post(test.directory, `/session/${session}/message`, {
            agent: "build",
            model: { providerID: "test", modelID: "test-model" },
            noReply: true,
            parts: [{ type: "text", text: "seed" }],
          })

        // Positive control for every negative instrument below.
        const control = yield* create(test.directory)
        expect((yield* seed(control.id)).status).toBe(200)
        trace.length = 0
        yield* llm.text("summarize control")
        const controlCalls = yield* llm.calls
        expect((yield* summarize(control.id)).status).toBe(200)
        expect(trace).toEqual(["cleanup:start", "cleanup:end", "compact"])
        expect((yield* llm.calls) - controlCalls).toBe(1)

        const target = yield* create(test.directory)
        expect((yield* seed(target.id)).status).toBe(200)
        const entered = yield* Deferred.make<void>()
        const blocked = yield* Deferred.make<void>()
        cleanupPause = { session: target.id, entered, blocked }
        trace.length = 0
        const calls = yield* llm.calls
        const interrupted = yield* summarize(target.id).pipe(Effect.forkScoped)
        yield* Deferred.await(entered)

        // The request is genuinely mid-cleanup and no fence existed when it entered.
        expect(trace).toEqual(["cleanup:start"])
        expect(captured.closure).toBeDefined()
        expect((yield* captured.closure!.view).fences).toEqual([])
        expect((yield* llm.calls) - calls).toBe(0)

        const fence = yield* standFence(target.id)
        yield* Fiber.await(interrupted)
        expect(trace).toEqual(["cleanup:start"])
        expect((yield* llm.calls) - calls).toBe(0)

        yield* release(fence, "k55_mid_summarize")
        cleanupPause = undefined
        trace.length = 0
        yield* llm.text("summarize after release")
        const releasedCalls = yield* llm.calls
        expect((yield* summarize(target.id)).status).toBe(200)
        expect(trace).toEqual(["cleanup:start", "cleanup:end", "compact"])
        expect((yield* llm.calls) - releasedCalls).toBe(1)
      }),
    instance,
  )

  it.instance(
    "K83: a fence landing during lazy command setup interrupts its pre-bind owner before Process.text/plugin/provider work",
    () =>
      Effect.gen(function* () {
        runs.queue = yield* Queue.unbounded<HeldRun>()
        const test = yield* TestInstance
        const llm = yield* TestLLMServer
        const commandPath = (session: SessionID) => `/session/${session}/command`
        const commandBody = { command: "probe", arguments: "", agent: "build", model: "test/test-model" }
        const shellTemplate = (marker: string) => `before !\`echo expanded > "${marker.replaceAll("\\", "/")}"\` after`

        // Positive control for every negative instrument below. The same lazy template resolves,
        // Process.text executes its shell expansion (the marker is the observable side effect),
        // command.execute.before runs, the transcript is written and the provider is called.
        const control = yield* create(test.directory)
        const controlMarker = path.join(test.directory, "k83-control-marker.txt")
        expect(yield* Effect.promise(() => Bun.file(controlMarker).exists())).toBe(false)
        commandTemplates.set("probe", shellTemplate(controlMarker))
        lookups.length = 0
        expansions.length = 0
        pluginCalls.length = 0
        yield* llm.text("command setup control")
        const controlCalls = yield* llm.calls
        expect((yield* post(test.directory, commandPath(control.id), commandBody)).status).toBe(200)
        expect(lookups).toEqual(["probe"])
        expect(expansions).toEqual(["probe"])
        expect(yield* Effect.promise(() => Bun.file(controlMarker).exists())).toBe(true)
        expect(pluginCalls.filter((name) => name === "command.execute.before")).toHaveLength(1)
        expect((yield* llm.calls) - controlCalls).toBe(1)
        expect(yield* messages(test.directory, control.id)).toHaveLength(2)

        const target = yield* create(test.directory)
        const targetMarker = path.join(test.directory, "k83-target-marker.txt")
        const entered = yield* Deferred.make<void>()
        const template = yield* Deferred.make<string>()
        templatePause = { name: "probe", entered, template: Effect.runPromise(Deferred.await(template)) }
        lookups.length = 0
        expansions.length = 0
        pluginCalls.length = 0
        retirements.length = 0
        const calls = yield* llm.calls
        const waiting = yield* post(test.directory, commandPath(target.id), commandBody).pipe(Effect.forkScoped)
        yield* Deferred.await(entered)

        // The command is genuinely in flight under its signalable pre-bind lease, parked at the
        // real lazy-template await. The read-only lookup and getter ran; every executable stage
        // after the unresolved template is still absent.
        const closure = captured.closure
        if (!closure) return yield* Effect.die("the composed coordinator was never captured")
        expect((yield* closure.view).fences).toEqual([])
        const before = (yield* closure.view).leases.filter(
          (item) => item.session === Model.id("session", target.id) && item.source === "SessionPrompt.command",
        )
        expect(before).toHaveLength(1)
        expect(before[0]?.kind).toBe("pre_bind")
        expect(before[0]?.acquisition).toBe("pre_fence")
        expect(before[0]?.state).toBe("reserved")
        expect(lookups).toEqual(["probe"])
        expect(expansions).toEqual(["probe"])
        expect(yield* Effect.promise(() => Bun.file(targetMarker).exists())).toBe(false)
        expect(pluginCalls.filter((name) => name === "command.execute.before")).toHaveLength(0)
        expect((yield* llm.calls) - calls).toBe(0)
        expect(yield* messages(test.directory, target.id)).toHaveLength(0)

        const fence = yield* standFence(target.id)
        yield* Fiber.await(waiting)
        yield* Deferred.succeed(template, shellTemplate(targetMarker))
        yield* Effect.sleep("25 millis")

        // Resolving the abandoned Promise after interruption cannot resurrect the command body.
        expect(yield* Effect.promise(() => Bun.file(targetMarker).exists())).toBe(false)
        expect(pluginCalls.filter((name) => name === "command.execute.before")).toHaveLength(0)
        expect((yield* llm.calls) - calls).toBe(0)
        expect(yield* messages(test.directory, target.id)).toHaveLength(0)
        const after = (yield* closure.view).leases.filter((item) => item.id === before[0]!.id)
        expect(after).toEqual([])
        expect(retirements.filter((lease) => lease === before[0]!.id)).toHaveLength(1)

        yield* release(fence, "k83_mid_command")
      }),
    instance,
  )

  it.instance(
    "K85: a fence landing at shell bind interrupts one pre-bind lease before any process starts",
    () =>
      Effect.gen(function* () {
        runs.queue = yield* Queue.unbounded<HeldRun>()
        const test = yield* TestInstance
        const shellPath = (session: SessionID) => `/session/${session}/shell`
        const shellBody = { agent: "build", command: "echo shell" }

        // Positive control: the same HTTP → SessionPrompt.shell → startShell → shellImpl graph
        // delegates the real bind, invokes shell.env, calls the spawner exactly once, writes its
        // transcript, and retires the one lease when no fence lands.
        const control = yield* create(test.directory)
        const controlSpawns: string[] = []
        spawnCapture = { match: shellBody.command, commands: controlSpawns }
        binds.length = 0
        retirements.length = 0
        pluginCalls.length = 0
        expect((yield* post(test.directory, shellPath(control.id), shellBody)).status).toBe(200)
        expect(controlSpawns).toHaveLength(1)
        expect(pluginCalls.filter((name) => name === "shell.env")).toHaveLength(1)
        expect(yield* messages(test.directory, control.id)).toHaveLength(2)
        const controlBinds = binds.filter(
          (item) => item.owner.type === "scope" && item.owner.id === Model.id("scope", `shell:${control.id}`),
        )
        expect(controlBinds).toHaveLength(1)
        expect(retirements.filter((lease) => lease === controlBinds[0]!.lease)).toHaveLength(1)

        const target = yield* create(test.directory)
        const entered = yield* Deferred.make<void>()
        const blocked = yield* Deferred.make<void>()
        bindPause = { session: target.id, entered, blocked }
        const targetSpawns: string[] = []
        spawnCapture = { match: shellBody.command, commands: targetSpawns }
        binds.length = 0
        retirements.length = 0
        pluginCalls.length = 0
        const waiting = yield* post(test.directory, shellPath(target.id), shellBody).pipe(Effect.forkScoped)
        yield* Deferred.await(entered)

        // This is the exact pre-bind boundary: startShell has reserved one signalable lease and
        // called bindTo, but the wrapper has not delegated the real bind and shellImpl cannot yet
        // persist rows, call shell.env, or start the process.
        const closure = captured.closure
        if (!closure) return yield* Effect.die("the composed coordinator was never captured")
        expect((yield* closure.view).fences).toEqual([])
        const before = (yield* closure.view).leases.filter(
          (item) => item.session === Model.id("session", target.id) && item.source === "SessionRunState.startShell",
        )
        expect(before).toHaveLength(1)
        expect(before[0]?.kind).toBe("pre_bind")
        expect(before[0]?.acquisition).toBe("pre_fence")
        expect(before[0]?.state).toBe("reserved")
        expect(binds).toHaveLength(0)
        expect(targetSpawns).toHaveLength(0)
        expect(pluginCalls.filter((name) => name === "shell.env")).toHaveLength(0)
        expect(yield* messages(test.directory, target.id)).toHaveLength(0)

        const fence = yield* standFence(target.id)
        yield* Fiber.await(waiting)
        yield* Deferred.succeed(blocked, undefined)
        yield* Effect.sleep("25 millis")

        expect(binds).toHaveLength(0)
        expect(targetSpawns).toHaveLength(0)
        expect(pluginCalls.filter((name) => name === "shell.env")).toHaveLength(0)
        expect(yield* messages(test.directory, target.id)).toHaveLength(0)
        const after = (yield* closure.view).leases.filter((item) => item.id === before[0]!.id)
        expect(after).toEqual([])
        expect(retirements.filter((lease) => lease === before[0]!.id)).toHaveLength(1)

        yield* release(fence, "k85_mid_shell")
      }),
    instance,
  )

  taskIt.instance(
    "K70: the real feature-off notifier suppresses ambient continuation reuse under a standing fence",
    () =>
      Effect.gen(function* () {
        runs.queue = yield* Queue.unbounded<HeldRun>()
        const boot = yield* bootstrapTask
        const closure = captured.closure
        if (!closure) return yield* Effect.die("the composed coordinator was never captured")

        const execute = (parent: SessionID, message: MessageID, label: string, ops: TaskPromptOps) =>
          boot.task.execute(
            {
              description: label,
              prompt: "return one short result",
              subagent_type: "general",
              async: true,
            },
            taskContext(boot.capture.context, parent, message, ops),
          )
        const leases = (parent: SessionID) =>
          closure.view.pipe(
            Effect.map((view) => view.leases.filter((item) => item.session === Model.id("session", parent))),
          )
        const continuation = (parent: SessionID, state?: Model.LeaseView["state"]) =>
          pollWithTimeout(
            leases(parent).pipe(
              Effect.map((items) =>
                items.find(
                  (item) =>
                    item.kind === "continuation" &&
                    item.source === "TaskTool.notifyBackgroundResult" &&
                    (state === undefined || item.state === state),
                ),
              ),
            ),
            `K70 continuation never reached ${state ?? "the coordinator"}`,
          )

        // POSITIVE CONTROL. The exact production TaskTool -> BackgroundJob observer ->
        // TaskPromptOps.prompt -> SessionPrompt graph delivers once when no fence stands. Every
        // zero below uses these same row/provider/disposition instruments.
        yield* boot.llm.reset
        dispositions.length = 0
        const controlRowsBefore = yield* messages(boot.test.directory, boot.caller.id)
        yield* boot.llm.text("child control complete")
        yield* boot.llm.text("notifier control injected")
        const controlCalls = yield* boot.llm.calls
        const controlAdmissions = admissions.length
        const controlReceipt = yield* execute(
          boot.caller.id,
          boot.capture.context.messageID,
          "K70 unfenced control",
          boot.capture.ops,
        )
        const controlChild = controlReceipt.metadata.sessionId
        if (!controlChild) return yield* Effect.die("K70 control receipt omitted its child Session")
        const controlWait = yield* boot.jobs.wait({ id: controlChild, timeout: 10_000 })
        expect(controlWait.timedOut).toBe(false)
        expect(controlWait.info?.status).toBe("completed")
        const controlRows = yield* pollWithTimeout(
          messages(boot.test.directory, boot.caller.id).pipe(
            Effect.map((rows) => {
              if (rows.length !== controlRowsBefore.length + 2) return
              const ready = rows.some(
                (row) =>
                  row.info.role === "assistant" &&
                  row.parts.some((part) => part.type === "text" && part.text === "notifier control injected"),
              )
              return ready ? rows : undefined
            }),
          ),
          "K70 unfenced notifier never wrote its one User/assistant turn",
        )
        const controlAdded = controlRows.filter(
          (row) => !controlRowsBefore.some((before) => before.info.id === row.info.id),
        )
        expect(controlAdded).toHaveLength(2)
        const controlUser = controlAdded.find((row) => row.info.role === "user")
        const controlAssistant = controlAdded.find((row) => row.info.role === "assistant")
        expect(controlUser).toBeDefined()
        expect(controlUser?.parts).toHaveLength(1)
        expect(controlUser?.parts[0]?.type).toBe("text")
        if (controlUser?.parts[0]?.type === "text") {
          expect(controlUser.parts[0].synthetic).toBe(true)
          expect(controlUser.parts[0].text).toBe(
            renderOutput({ sessionID: controlChild, state: "completed", text: "child control complete" }),
          )
        }
        expect(controlAssistant?.parts.findLast((part) => part.type === "text")?.text).toBe("notifier control injected")
        expect((yield* boot.llm.calls) - controlCalls).toBe(2)
        const controlContinuation = admissions
          .slice(controlAdmissions)
          .find(
            (item) =>
              item.input.session === boot.caller.id &&
              item.input.source === "TaskTool.notifyBackgroundResult" &&
              "kind" in item.input &&
              item.input.kind === "continuation" &&
              item.decision.type === "admitted",
          )
        const controlDecision = controlContinuation?.decision
        expect(controlDecision?.type).toBe("admitted")
        if (controlDecision?.type !== "admitted") return yield* Effect.die("missing control continuation")
        const controlDisposition = yield* pollWithTimeout(
          Effect.sync(() =>
            dispositions.find((item) => item.lease === controlDecision.lease && item.disposition === "retired"),
          ),
          "K70 control continuation never retired",
        )
        expect(controlDisposition).toEqual({ lease: controlDecision.lease, disposition: "retired" })
        expect((yield* leases(boot.caller.id)).filter((item) => item.id === controlDecision.lease)).toEqual([])
        expect((yield* leases(boot.caller.id)).filter((item) => item.source === "TaskPromptOps.prompt")).toEqual([])

        // TARGET. The child provider is parked until a real fence owns the already-acquired parent
        // continuation. Releasing the child then drives the REAL notifier into its causal ambient
        // reuse; only the child response is allowed to reach the provider.
        const parent = yield* create(boot.test.directory)
        const parentMessage = yield* seedTaskAssistant(boot.sessions, parent.id, boot.test.directory)
        const baselineRows = yield* messages(boot.test.directory, parent.id)
        expect(baselineRows).toHaveLength(2)
        yield* boot.llm.reset
        dispositions.length = 0
        const childEntered = yield* Deferred.make<void>()
        const childRelease = yield* Deferred.make<void>()
        let parentAttempts = 0
        const production = boot.capture.ops
        const gated: TaskPromptOps = {
          ...production,
          prompt: (input) => {
            if (input.sessionID === parent.id) {
              parentAttempts += 1
              return production.prompt(input)
            }
            return Deferred.succeed(childEntered, undefined).pipe(
              Effect.andThen(Deferred.await(childRelease)),
              Effect.andThen(production.prompt(input)),
            )
          },
        }
        yield* boot.llm.text("child fenced-path complete")
        // Deliberately queued so a broken guard finishes rather than hanging: if the forbidden
        // parent provider call occurs, row/effect assertions turn red instead of timing out.
        yield* boot.llm.text("FORBIDDEN notifier injection")
        const fencedCalls = yield* boot.llm.calls
        const receipt = yield* execute(parent.id, parentMessage, "K70 fenced notifier", gated)
        const child = receipt.metadata.sessionId
        if (!child) return yield* Effect.die("K70 fenced receipt omitted its child Session")
        yield* Deferred.await(childEntered)
        const live = yield* continuation(parent.id, "reserved")
        expect(live.acquisition).toBe("pre_fence")
        expect(live.operation).toBeUndefined()
        const idsBeforeFence = (yield* leases(parent.id)).map((item) => item.id).toSorted()
        expect(idsBeforeFence).toContain(live.id)

        const fence = yield* standFence(parent.id)
        const adopted = (yield* leases(parent.id)).find((item) => item.id === live.id)
        expect(adopted?.operation).toBe(fence.operation)
        expect(adopted?.state).toBe("reserved")
        yield* prepareQuiescence(fence)
        const blocked = yield* proveQuiescence(fence)
        expect(blocked.decision).toEqual({ type: "rejected", reason: "unverified" })
        const revisionBeforeResult = operation(yield* closure.view, fence.operation).revision

        yield* Deferred.succeed(childRelease, undefined)
        const waited = yield* boot.jobs.wait({ id: child, timeout: 10_000 })
        expect(waited.timedOut).toBe(false)
        expect(waited.info?.status).toBe("completed")
        const suppressed = yield* pollWithTimeout(
          Effect.sync(() => dispositions.find((item) => item.lease === live.id && item.disposition === "suppressed")),
          "K70 continuation never settled after its injection attempt",
        )
        yield* pollWithTimeout(
          Effect.sync(() => (parentAttempts === 1 ? true : undefined)),
          "K70 notifier never attempted its parent injection",
        )

        // §8.7 clauses 8-9 at the row/effect boundary. The attempt happened, but the pull-side
        // revalidation refused before cleanup, synthetic Message/Part persistence, loop, or provider.
        expect(parentAttempts).toBe(1)
        expect(yield* messages(boot.test.directory, parent.id)).toEqual(baselineRows)
        expect((yield* boot.llm.calls) - fencedCalls).toBe(1)

        // K70/I-31 accounting. The SAME continuation is terminally suppressed, no prompt lease was
        // minted, and ordinary terminal rows are compacted once their owners settle.
        expect(suppressed).toEqual({ lease: live.id, disposition: "suppressed" })
        const afterSuppression = yield* leases(parent.id)
        expect(afterSuppression).toEqual([])
        expect(afterSuppression.filter((item) => item.source === "TaskPromptOps.prompt")).toEqual([])
        expect(dispositions.filter((item) => item.lease === live.id)).toEqual([
          { lease: live.id, disposition: "suppressed" },
        ])
        // One applied terminal transition. The observer's ordinary finalizer issues the sole
        // suppressed finish; neither the model check nor the coordinator pre-settles the lease.
        expect(operation(yield* closure.view, fence.operation).revision).toBe(revisionBeforeResult + 1n)

        // The refusal solves safety without creating the liveness failure the old behaviour avoided:
        // the live continuation set is empty, a new stable proof applies, and real release commits.
        expect(
          afterSuppression.filter(
            (item) => item.kind === "continuation" && (item.state === "reserved" || item.state === "bound"),
          ),
        ).toEqual([])
        const proved = yield* proveQuiescence(fence)
        expect(proved.decision.type).toBe("applied")
        const released = yield* commitRelease(fence, "k70_suppressed_continuation")
        expect(Exit.isSuccess(released)).toBe(true)
        expect((yield* closure.view).fences.some((item) => item.session === fence.root)).toBe(false)
      }),
    instance,
  )
})

describe("side operations retain upstream behavior without attachment jurisdiction", () => {
  attachmentIt.instance(
    "manual summarize queues behind the live Runner without disturbing its attachment scope",
    () =>
      Effect.gen(function* () {
        const active = yield* startAttachedRunner("Attached summarize")
        const compacted = (rows: SessionV1.WithParts[]) =>
          rows.some((row) => row.parts.some((part) => part.type === "compaction"))
        expect(compacted(active.baseline)).toBe(false)
        const beforeState = active.scope.current()
        const calls = yield* active.llm.calls
        const settled = yield* Deferred.make<void>()

        yield* active.llm.text("summary after attached turn")
        const waiting = yield* post(active.test.directory, `/session/${active.target.id}/summarize`, {
          providerID: "test",
          modelID: "test-model",
        }).pipe(Effect.ensuring(Deferred.succeed(settled, undefined).pipe(Effect.ignore)), Effect.forkScoped)
        yield* pollWithTimeout(
          messages(active.test.directory, active.target.id).pipe(
            Effect.map((rows) => (compacted(rows) ? true : undefined)),
          ),
          "summarize did not reach compaction before joining the live Runner",
        )
        expect(yield* Deferred.isDone(settled)).toBe(false)
        expect(yield* active.llm.calls).toBe(calls)
        expect(active.scope.current()).toEqual(beforeState)

        yield* finishAttachedRunner(active)
        const response = yield* awaitWithTimeout(
          Fiber.join(waiting),
          "summarize did not settle after the attached Runner",
          "10 seconds",
        )
        yield* Effect.yieldNow

        expect(response.status).toBe(200)
        expect(compacted(yield* messages(active.test.directory, active.target.id))).toBe(true)
        expect(yield* active.llm.calls).toBe(calls + 1)
        expect(active.scope.current()).toMatchObject({ failed: false, cancelled: false })
      }),
    instance,
    30_000,
  )

  attachmentIt.instance(
    "session replay uses its ordinary mutation path without disturbing the live attached Runner",
    () =>
      Effect.gen(function* () {
        const active = yield* startAttachedRunner("Attached replay")
        const historyResponse = yield* post(active.test.directory, "/sync/history", {})
        expect(historyResponse.status).toBe(200)
        const history = (yield* historyResponse.json) as Array<{
          id: string
          aggregate_id: string
          seq: number
          type: string
          data: Record<string, unknown>
        }>
        const sequences = history.filter((event) => event.aggregate_id === active.target.id).map((event) => event.seq)
        expect(sequences.length).toBeGreaterThan(0)
        const foreign = MessageID.ascending()
        const replay = yield* post(active.test.directory, "/sync/replay", {
          directory: active.test.directory,
          events: [
            {
              id: EventV2.ID.make(`evt_attachment_${foreign}`),
              aggregateID: active.target.id,
              seq: Math.max(...sequences) + 1,
              type: "message.updated.1",
              data: {
                sessionID: active.target.id,
                info: {
                  id: foreign,
                  sessionID: active.target.id,
                  role: "user",
                  agent: "build",
                  model: { providerID: "test", modelID: "test-model" },
                  time: { created: Date.now() },
                },
              },
            },
          ],
        })

        yield* finishAttachedRunner(active)
        yield* Effect.yieldNow

        expect(replay.status).toBe(200)
        expect((yield* messages(active.test.directory, active.target.id)).some((row) => row.info.id === foreign)).toBe(
          true,
        )
        expect(active.scope.current().failed).toBe(false)
      }),
    instance,
    30_000,
  )

  attachmentIt.instance(
    "shell preserves upstream Busy behavior without attachment-specific refusal or collateral effects",
    () =>
      Effect.gen(function* () {
        const active = yield* startAttachedRunner("Attached shell")
        const command = "echo attachment-shell-must-not-run"
        const spawns: string[] = []
        spawnCapture = { match: command, commands: spawns }
        pluginCalls.length = 0

        const response = yield* post(active.test.directory, `/session/${active.target.id}/shell`, {
          agent: "build",
          command,
        })
        yield* Effect.yieldNow

        expect(response.status).toBe(409)
        expect(spawns).toEqual([])
        expect(pluginCalls.filter((name) => name === "shell.env")).toEqual([])
        expect(yield* messages(active.test.directory, active.target.id)).toEqual(active.baseline)
        expect(active.scope.current()).toMatchObject({ failed: false, cancelled: false })
      }),
    instance,
    30_000,
  )

  attachmentIt.instance(
    "command uses ordinary expansion and Runner serialization without attachment jurisdiction",
    () =>
      Effect.gen(function* () {
        const active = yield* startAttachedRunner("Attached command")
        const marker = path.join(active.test.directory, "attachment-command-marker.txt")
        commandTemplates.set("probe", `before !\`echo expanded > "${marker.replaceAll("\\", "/")}"\` after`)
        lookups.length = 0
        expansions.length = 0
        pluginCalls.length = 0
        expect(yield* Effect.promise(() => Bun.file(marker).exists())).toBe(false)
        const beforeState = active.scope.current()
        const calls = yield* active.llm.calls
        const settled = yield* Deferred.make<void>()

        yield* active.llm.text("command after attached turn")
        const waiting = yield* post(active.test.directory, `/session/${active.target.id}/command`, {
          command: "probe",
          arguments: "",
          agent: "build",
          model: "test/test-model",
        }).pipe(Effect.ensuring(Deferred.succeed(settled, undefined).pipe(Effect.ignore)), Effect.forkScoped)
        yield* pollWithTimeout(
          Effect.sync(() => (expansions.length > 0 ? true : undefined)),
          "command did not reach ordinary expansion while the attached Runner was live",
        )
        expect(yield* Deferred.isDone(settled)).toBe(false)
        expect(yield* active.llm.calls).toBe(calls)
        expect(active.scope.current()).toEqual(beforeState)

        yield* finishAttachedRunner(active)
        const response = yield* awaitWithTimeout(
          Fiber.join(waiting),
          "command did not settle after the attached Runner",
          "10 seconds",
        )

        expect(response.status).toBe(200)
        expect(lookups).toEqual(["probe"])
        expect(expansions).toEqual(["probe"])
        expect(yield* Effect.promise(() => Bun.file(marker).exists())).toBe(true)
        expect(pluginCalls.filter((name) => name === "command.execute.before")).toHaveLength(1)
        expect(yield* active.llm.calls).toBe(calls + 1)
        expect(active.scope.current()).toMatchObject({ failed: false, cancelled: false })
      }),
    instance,
    30_000,
  )
})
