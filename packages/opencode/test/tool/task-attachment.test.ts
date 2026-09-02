import { afterEach, describe, expect } from "bun:test"
import { Cause, Deferred, Effect, Exit, Fiber, Layer } from "effect"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Database } from "@opencode-ai/core/database/database"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { Ripgrep } from "@opencode-ai/core/ripgrep"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { Agent } from "@/agent/agent"
import { BackgroundJob } from "@/background/job"
import { Config } from "@/config/config"
import { EventV2Bridge } from "@/event-v2-bridge"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { Provider } from "@/provider/provider"
import { Session } from "@/session/session"
import { AttachmentCoordinator } from "@/session/attachment/coordinator"
import { MessageID, PartID, SessionID } from "@/session/schema"
import { SessionRunState } from "@/session/run-state"
import { SessionStatus } from "@/session/status"
import type { SessionPrompt } from "@/session/prompt"
import { Truncate } from "@/tool/truncate"
import { TaskTool, type TaskPromptOps } from "@/tool/task"
import { Tool } from "@/tool/tool"
import { ToolRegistry } from "@/tool/registry"
import { ProviderTest } from "../fake/provider"
import { disposeAllInstances } from "../fixture/fixture"
import { answered } from "../lib/background"
import { admittingClosure, unusedJobs } from "../lib/closure"
import { recordingPhysical } from "../lib/physical"
import { awaitWithTimeout, pollWithTimeout, testEffect } from "../lib/effect"
import { SessionAdmission } from "@/session/closure/admission"
import { SessionClosure } from "@/session/closure/coordinator"
import { SessionClosureDiscovery } from "@/session/closure/discovery"
import { SessionClosureModel as Model } from "@/session/closure/model"
import { SessionPhysical } from "@/session/physical-interrupt"
import { renderOutput, type TaskSelectedReturn } from "@/session/task-return"

// These fixtures reach the unattached path — the "root async" cases route through `attach()` ->
// `notify`, which acquires a continuation lease — so a real capability is required here, not a
// stub. Only the coordinator is faked; the shipped acquire/observe/settle split runs.
const attachmentContinuationClosure: SessionClosure.Interface = {
  ...unusedJobs,
  request: () => Effect.die("unused"),
  view: Effect.die("unused"),
  identity: Effect.die("unused"),
  acquire: () =>
    Effect.succeed({
      type: "admitted" as const,
      lease: Model.id("lease", "lease_attachment_continuation"),
      epoch: 0n,
      instance: Model.id("instance", "instance_attachment"),
    }),
  bind: () => Effect.void,
  retire: () => Effect.void,
  reserveMutation: () => Effect.die("unused"),
  activateMutation: () => Effect.void,
  retireMutation: () => Effect.void,
}

// The closure above discards its disposition, so it can show that a lease was taken but not how it
// settled. These record both, because the three-way settlement mapping is the property under test
// on the attached path, and only a recording coordinator can observe it.
type ContinuationLog = {
  readonly acquired: Array<{ session: SessionID; caller: SessionID; target: SessionID; kind: string }>
  readonly settled: Array<{ lease: string; disposition: string }>
  readonly events: string[]
}

const continuationLog = (): ContinuationLog => ({ acquired: [], settled: [], events: [] })

const recordingContinuationClosure = (log: ContinuationLog): SessionClosure.Interface => ({
  ...attachmentContinuationClosure,
  acquire: (input) =>
    Effect.sync(() => {
      const detail = input as unknown as { kind?: string; caller?: SessionID; target?: SessionID }
      log.events.push("acquire")
      log.acquired.push({
        session: input.session,
        caller: detail.caller ?? input.session,
        target: detail.target ?? input.session,
        kind: detail.kind ?? "pre_bind",
      })
      return {
        type: "admitted" as const,
        lease: Model.id("lease", `lease_attached_${log.acquired.length}`),
        epoch: 0n,
        instance: Model.id("instance", "instance_attachment"),
      }
    }),
  retire: (lease, disposition) =>
    Effect.sync(() => {
      log.events.push(`settle:${disposition ?? "retired"}`)
      log.settled.push({ lease, disposition: disposition ?? "retired" })
    }),
})

// Fences every continuation acquisition, so `acquireContinuation` refuses BEFORE any lease exists.
// The attempt is still recorded: without it, "nothing was settled" would be satisfied by a call
// that never happened.
const fencingContinuationClosure = (log: ContinuationLog): SessionClosure.Interface => ({
  ...recordingContinuationClosure(log),
  acquire: (input) =>
    Effect.sync(() => {
      log.events.push("acquire-refused")
      log.acquired.push({ session: input.session, caller: input.session, target: input.session, kind: "continuation" })
      return {
        type: "fenced" as const,
        state: "closing" as const,
        operation: Model.id("operation", "operation_attachment_fence"),
        epoch: 0n,
      }
    }),
})

// ONE closure instance per test, closed over here, so every acquisition in a test reaches the same
// object the test holds. A fresh instance per call would still share `log` and the assertions would
// still pass — which is exactly why it is worth avoiding: it would make the identity claim
// incidental rather than structural. (`continuationOps` in task.test.ts documents the same choice.)
const continuationOps = (closure: SessionClosure.Interface, base: TaskPromptOps): TaskPromptOps => ({
  ...base,
  acquireContinuation: (input) => SessionAdmission.acquireContinuation(closure, input),
})

// The observer settles on a forked fiber, so the assertions need a synchronization point after the
// job itself is done. Bounded, so a regression fails an assertion rather than hanging the suite.
const awaitSettled = Effect.fn("TaskAttachmentTest.awaitSettled")(function* (log: ContinuationLog, minimum = 1) {
  for (let attempt = 0; attempt < 1000 && log.settled.length < minimum; attempt++) {
    yield* Effect.yieldNow
  }
})

afterEach(async () => {
  await disposeAllInstances()
})

const ref = {
  providerID: ProviderV2.ID.make("test"),
  modelID: ModelV2.ID.make("test-model"),
}

function selectedAssistant(value: TaskSelectedReturn) {
  if (value.type === "cancelled") return undefined
  if (!value.candidate && !value.observed) return value.fallback
  if (!value.candidate) return value.observed!.assistant
  if (!value.observed) return value.candidate.assistant
  return value.observed.order > value.candidate.order ? value.observed.assistant : value.candidate.assistant
}

function selectedText(value: TaskSelectedReturn) {
  return selectedAssistant(value)?.parts.findLast((part) => part.type === "text")?.text
}

function completedOutput(sessionID: SessionID, text: string) {
  return renderOutput({ sessionID, state: "completed", text })
}

const providerLayer = Layer.mock(Provider.Service)({
  getModel: () => Effect.succeed(ProviderTest.model({ providerID: ref.providerID, id: ref.modelID })),
})

const layer = LayerNode.compile(
  LayerNode.group([
    Agent.node,
    BackgroundJob.node,
    EventV2Bridge.node,
    Config.node,
    CrossSpawnSpawner.node,
    Session.node,
    SessionProjector.node,
    SessionRunState.node,
    SessionStatus.node,
    Truncate.node,
    ToolRegistry.node,
    Database.node,
    RuntimeFlags.node,
    Ripgrep.node,
    SessionClosureDiscovery.node,
  ]),
  [
    // Every test in this file exercises attachment, which is reached only with the flag on.
    [RuntimeFlags.node, RuntimeFlags.layer({ experimentalBackgroundSubagents: true })],
    [Provider.node, providerLayer],
    // Discovery needs a `SessionPhysical` to build. It is never invoked here: discovery stores each
    // entry's `interrupt` as an unevaluated Effect, so reading `jobs` observes metadata without
    // signalling anything. A recorder rather than the real service keeps it that way.
    [SessionPhysical.node, Layer.succeed(SessionPhysical.Service, recordingPhysical())],
    // The background binder resolves whichever coordinator the layer provides, so the fake that
    // admits every bind must be the one it finds; otherwise every job is refused as
    // `refused_by_authority` and surfaces as a cancelled task.
    [SessionClosure.node, admittingClosure],
  ],
)

const it = testEffect(layer)

const seed = Effect.fn("TaskAttachmentTest.seed")(function* () {
  const sessions = yield* Session.Service
  const chat = yield* sessions.create({ title: "Caller" })
  const user = yield* sessions.updateMessage({
    id: MessageID.ascending(),
    role: "user",
    sessionID: chat.id,
    agent: "build",
    model: ref,
    time: { created: Date.now() },
  })
  const assistant: SessionV1.Assistant = {
    id: MessageID.ascending(),
    role: "assistant",
    parentID: user.id,
    sessionID: chat.id,
    mode: "build",
    agent: "build",
    cost: 0,
    path: { cwd: "/tmp", root: "/tmp" },
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    modelID: ref.modelID,
    providerID: ref.providerID,
    time: { created: Date.now() },
  }
  yield* sessions.updateMessage(assistant)
  return { chat, assistant }
})

function reply(input: SessionPrompt.PromptInput, text: string): SessionV1.WithParts {
  const messageID = MessageID.ascending()
  return {
    info: {
      id: messageID,
      role: "assistant",
      parentID: input.messageID ?? MessageID.ascending(),
      sessionID: input.sessionID,
      mode: input.agent ?? "general",
      agent: input.agent ?? "general",
      cost: 0,
      path: { cwd: "/tmp", root: "/tmp" },
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      modelID: input.model?.modelID ?? ref.modelID,
      providerID: input.model?.providerID ?? ref.providerID,
      time: { created: Date.now(), completed: Date.now() },
      finish: "stop",
    },
    parts: [{ id: PartID.ascending(), messageID, sessionID: input.sessionID, type: "text", text }],
  }
}

/**
 * Makes a fixture's prompt fire `onAdmitted`, the way production's does once the prompt is durably
 * persisted and before the runner is entered.
 *
 * Same-ID admission ordering depends on that hook: an owner settles its claim there, and a second
 * call naming the same task_id waits on that settlement. Without it an owner parked in its run would
 * never settle, and every supplemental prompt in this file would wait behind it forever. Applied
 * centrally here so each test's own prompt stub stays about what it is testing.
 */
const admitting = (ops: TaskPromptOps): TaskPromptOps => ({
  ...ops,
  prompt: (input) =>
    Effect.gen(function* () {
      if (input.onAdmitted) yield* input.onAdmitted
      return yield* ops.prompt(input)
    }),
})

function context(input: {
  sessionID: SessionID
  messageID: MessageID
  promptOps: TaskPromptOps
  attachment?: AttachmentCoordinator.Scope
}): Tool.Context {
  return {
    sessionID: input.sessionID,
    messageID: input.messageID,
    agent: "build",
    abort: new AbortController().signal,
    extra: { promptOps: admitting(input.promptOps), attachment: input.attachment },
    messages: [],
    metadata: () => Effect.void,
    ask: () => Effect.void,
  }
}

/**
 * Reads a settled selection under CP-032 v0.12 Admission Freshness.
 *
 * `Scope.result` is an ELIGIBILITY operation, not a settled-state reader: an Assistant that was
 * never enrolled before publication is the fresh-answer case, so it comes back as its own evidence.
 * These rows previously read the parent's settled answer by calling `result()` afterwards with a
 * throwaway `"wrong fallback"` Assistant, which now legitimately returns that throwaway.
 *
 * Forking BEFORE the release that lets the gate resolve makes the probe a genuine unresolved
 * entrant: it enrols, latches as first fallback, and parks on the one-shot Deferred. Its text stays
 * distinguishable, so a selection that returned the caller's own Assistant still shows up as
 * "wrong fallback" rather than silently matching. The `yieldNow` is load-bearing -- `forkChild` only
 * schedules the fiber, so without it the probe would not have entered `result()` yet and would
 * arrive post-publication, passing for the wrong reason.
 */
const parkedRead = (scope: AttachmentCoordinator.Scope, sessionID: SessionID, probeText: string) =>
  Effect.gen(function* () {
    const settled = yield* Deferred.make<void>()
    const answer: { value: TaskSelectedReturn | undefined } = { value: undefined }
    yield* scope.result(reply({ sessionID, parts: [] } as SessionPrompt.PromptInput, probeText)).pipe(
      Effect.tap((value) =>
        Effect.sync(() => {
          answer.value = value
        }),
      ),
      Effect.ensuring(Deferred.succeed(settled, undefined)),
      Effect.forkChild,
    )
    yield* Effect.yieldNow
    expect(yield* Deferred.isDone(settled)).toBe(false)
    return Effect.gen(function* () {
      yield* Deferred.await(settled)
      if (!answer.value) return yield* Effect.die("the parked result never resolved")
      return answer.value
    })
  })

function basicOps(input: {
  prompt: TaskPromptOps["prompt"]
  // Required, mirroring `TaskPromptOps` itself, so a test cannot omit it and end up exercising a
  // private coordinator nobody can reach or assert on. Every caller in this file runs with
  // `experimentalBackgroundSubagents: true` (see the layer above), so every one reaches `open` and
  // `claim` and needs a real coordinator rather than a stub.
  attachments: AttachmentCoordinator.Interface
  wake?: TaskPromptOps["wake"]
  cancel?: TaskPromptOps["cancel"]
  physical?: TaskPromptOps["physical"]
}): TaskPromptOps {
  return {
    acquireContinuation: (input) => SessionAdmission.acquireContinuation(attachmentContinuationClosure, input),
    // The caller lease, driven through the shipped `admitScoped` against the same always-admitting
    // coordinator this file uses for continuations. Attachment behaviour is what these tests
    // assert, so the caller lease must be present and permissive here rather than a refusal surface.
    admitScoped: (input) => SessionAdmission.admitScoped(attachmentContinuationClosure, input),
    attachments: input.attachments,
    cancel: input.cancel ?? (() => Effect.void),
    // Required member; records rather than dies, for the reason `recordingPhysical` documents.
    physical: input.physical ?? recordingPhysical(),
    resolvePromptParts: (template) => Effect.succeed([{ type: "text" as const, text: template }]),
    prompt: input.prompt,
    wake: input.wake,
  }
}

const persist = Effect.fn("TaskAttachmentTest.persist")(function* (input: SessionPrompt.TaskPromptInput) {
  const scope = input.attachmentScope
  if (!scope) return
  yield* scope.own(input.messageID ?? MessageID.ascending())
  return scope
})

const admit = Effect.fn("TaskAttachmentTest.admit")(function* (input: SessionPrompt.TaskPromptInput, response: string) {
  const scope = yield* persist(input)
  const assistant = reply(input, response)
  if (scope) yield* scope.observeTurn({ assistant, clean: true })
  return assistant
})

function count(text: string, value: string) {
  return text.split(value).length - 1
}

describe("task attachment integration", () => {
  it.instance("a root async cancellation delivers exactly one unknown-status envelope", () =>
    Effect.gen(function* () {
      const jobs = yield* BackgroundJob.Service
      const runState = yield* SessionRunState.Service
      const coordinator = yield* AttachmentCoordinator.make
      const { chat, assistant } = yield* seed()
      const childReady = yield* Deferred.make<void>()
      const ownerCancelled = yield* Deferred.make<void>()
      const delivered = yield* Deferred.make<void>()
      const observerSettled = yield* Deferred.make<void>()
      const log = continuationLog()
      const deliveries: string[] = []
      const exactWaits: Array<{
        readonly handle: BackgroundJob.InvocationHandle
        readonly status: BackgroundJob.Info["status"] | undefined
      }> = []
      const observerTerminals: Array<{
        readonly handle: BackgroundJob.InvocationHandle
        readonly status: BackgroundJob.Info["status"] | undefined
      }> = []
      let ownerScope: AttachmentCoordinator.Scope | undefined
      let structuralProbe: SessionV1.WithParts | undefined

      const attachments: AttachmentCoordinator.Interface = {
        ...coordinator,
        open: (sessionID) =>
          coordinator.open(sessionID).pipe(
            Effect.map((scope): AttachmentCoordinator.Scope => {
              const instrumented: AttachmentCoordinator.Scope = {
                ...scope,
                claimCancellation: (status) =>
                  scope.claimCancellation(status).pipe(Effect.tap(() => Deferred.succeed(ownerCancelled, undefined))),
              }
              ownerScope = instrumented
              return instrumented
            }),
          ),
      }
      const observedJobs: BackgroundJob.Interface = {
        ...jobs,
        waitHandle: (input) =>
          jobs
            .waitHandle(input)
            .pipe(
              Effect.tap((waited) =>
                input.timeout === undefined
                  ? Effect.sync(() => exactWaits.push({ handle: input.handle, status: waited.info?.status }))
                  : Effect.void,
              ),
            ),
        waitAnswer: (input) =>
          jobs
            .waitAnswer(input)
            .pipe(
              Effect.tap((waited) =>
                waited.info
                  ? Effect.sync(() => observerTerminals.push({ handle: input.handle, status: waited.info?.status }))
                  : Effect.void,
              ),
            ),
      }
      const tool = yield* TaskTool.pipe(Effect.provideService(BackgroundJob.Service, observedJobs))
      const def = yield* tool.init()
      const baseClosure = recordingContinuationClosure(log)
      const closure: SessionClosure.Interface = {
        ...baseClosure,
        retire: (lease, disposition) =>
          baseClosure.retire(lease, disposition).pipe(Effect.ensuring(Deferred.succeed(observerSettled, undefined))),
      }
      const promptOps = continuationOps(
        closure,
        basicOps({
          attachments,
          prompt: (input) =>
            Effect.gen(function* () {
              if (input.sessionID === chat.id) {
                const text = input.parts.findLast((part) => part.type === "text")?.text ?? ""
                deliveries.push(text)
                yield* Deferred.succeed(delivered, undefined)
                return reply(input, "parent observed cancellation")
              }
              if (!input.attachmentScope) return yield* Effect.die("root async owner had no attachment scope")
              yield* persist(input)
              structuralProbe = reply(input, "root cancellation structural status probe")
              yield* Deferred.succeed(childReady, undefined)
              return yield* Effect.never
            }),
        }),
      )

      const started = yield* def.execute(
        { description: "root cancellation", prompt: "run", subagent_type: "general", async: true },
        context({ sessionID: chat.id, messageID: assistant.id, promptOps }),
      )
      const child = SessionID.make(started.metadata.sessionId)
      yield* awaitWithTimeout(Deferred.await(childReady), "root async child never reached its deterministic hold")

      yield* runState.cancel(child)
      const terminal = yield* jobs.wait({ id: child, timeout: 5_000 })
      expect(terminal.timedOut).toBe(false)
      expect(terminal.info?.status).toBe("cancelled")
      expect(terminal.info?.output).toBeUndefined()
      expect(Object.hasOwn(terminal.info ?? {}, "cancellationStatus")).toBe(false)
      yield* awaitWithTimeout(
        Deferred.await(ownerCancelled),
        "the exact cancelled terminal was not projected into the owner scope",
      )
      yield* awaitWithTimeout(Deferred.await(delivered), "root cancellation never attempted its parent callback")
      yield* awaitWithTimeout(Deferred.await(observerSettled), "root cancellation observer never settled")

      expect(deliveries).toHaveLength(1)
      const envelope = deliveries[0] ?? ""
      expect(count(envelope, `state="cancelled"`)).toBe(1)
      expect(count(envelope, "task_evidence=")).toBe(1)
      expect(envelope).toContain(`Task child was cancelled. task_id: ${child}. status: unknown.`)
      expect(envelope).toContain(`task_evidence=${JSON.stringify({ task_id: child, status: "unknown" })}`)
      expect(envelope).not.toContain("status: cancelled")
      expect(envelope).not.toContain('state="completed"')
      expect(envelope).not.toContain('state="error"')
      expect(envelope).not.toContain("Task failed")
      expect(envelope).not.toContain("interrupted")

      const scope = ownerScope
      const probe = structuralProbe
      if (!scope || !probe) return yield* Effect.die("root cancellation did not retain its structural probe")
      const selected = yield* scope.result(probe)
      expect(selected).toMatchObject({ type: "cancelled", status: "cancelled" })
      expect("fallback" in selected).toBe(false)

      expect(exactWaits).toHaveLength(1)
      expect(observerTerminals).toHaveLength(1)
      expect(exactWaits[0]?.status).toBe("cancelled")
      expect(observerTerminals[0]?.status).toBe("cancelled")
      expect(observerTerminals[0]?.handle).toEqual(exactWaits[0]?.handle)
      expect(log.acquired).toHaveLength(1)
      expect(log.settled).toHaveLength(1)
      expect(log.settled[0]?.disposition).toBe("retired")
    }),
  )

  it.instance("a joined dying Runner uses one message-free wake and only a later clean turn resolves", () =>
    Effect.gen(function* () {
      const coordinator = yield* AttachmentCoordinator.make
      const { chat, assistant } = yield* seed()
      const parent = yield* coordinator.open(chat.id)
      const tool = yield* TaskTool
      const def = yield* tool.init()
      const prompted = yield* Deferred.make<SessionPrompt.TaskPromptInput>()
      const wakeReady = yield* Deferred.make<void>()
      const wakeRelease = yield* Deferred.make<void>()
      let deliveryInput: SessionPrompt.TaskPromptInput | undefined
      let parentPrompts = 0
      let wakes = 0
      const promptOps = basicOps({
        attachments: coordinator,
        prompt: (input) => {
          if (input.sessionID !== chat.id) return Effect.succeed(reply(input, "child done"))
          parentPrompts += 1
          deliveryInput = input
          return persist(input).pipe(
            Effect.andThen(Deferred.succeed(prompted, input)),
            Effect.as(reply(input, "dying runner yield")),
          )
        },
        wake: (sessionID, attachment) =>
          Effect.gen(function* () {
            wakes += 1
            expect(attachment).toBe(parent)
            yield* Deferred.succeed(wakeReady, undefined)
            yield* Deferred.await(wakeRelease)
            if (attachment.sessionID !== sessionID || !deliveryInput) return yield* Effect.die("wrong wake scope")
            const response = reply(deliveryInput, "fresh wake final")
            yield* attachment.observeTurn({ assistant: response, clean: true })
            return response
          }),
      })

      yield* def.execute(
        { description: "wake child", prompt: "run", subagent_type: "general", async: true },
        context({ sessionID: chat.id, messageID: assistant.id, promptOps, attachment: parent }),
      )
      const notification = yield* Deferred.await(prompted)
      yield* Deferred.await(wakeReady)
      expect(parent.current()).toMatchObject({ undelivered: 0, candidate: false })
      expect(parentPrompts).toBe(1)
      expect(wakes).toBe(1)
      // Enter `result()` before the wake is released, so this probe parks as a genuine unresolved
      // entrant rather than reading back after the gate has already published.
      const settled = yield* parkedRead(parent, chat.id, "wrong fallback")
      yield* Deferred.succeed(wakeRelease, undefined)
      expect(selectedText(yield* settled)).toBe("fresh wake final")
      expect(parent.current().candidate).toBe(true)
      yield* parent.close()
    }),
  )

  it.instance("attached cancellation delivers the retained answer rather than inlining it", () =>
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const jobs = yield* BackgroundJob.Service
      const coordinator = yield* AttachmentCoordinator.make
      const { chat, assistant } = yield* seed()
      const parent = yield* coordinator.open(chat.id)
      const tool = yield* TaskTool
      const def = yield* tool.init()
      const firstReady = yield* Deferred.make<void>()
      const firstRelease = yield* Deferred.make<void>()
      const secondReady = yield* Deferred.make<void>()
      const injected = yield* Deferred.make<SessionPrompt.TaskPromptInput>()
      const parentPrompts: SessionPrompt.TaskPromptInput[] = []
      let childPrompts = 0
      const promptOps = basicOps({
        attachments: coordinator,
        prompt: (input) => {
          if (input.sessionID === chat.id) {
            parentPrompts.push(input)
            return Deferred.succeed(injected, input).pipe(Effect.andThen(admit(input, "parent final")))
          }
          childPrompts += 1
          if (childPrompts === 1) {
            return Deferred.succeed(firstReady, undefined).pipe(
              Effect.andThen(Deferred.await(firstRelease)),
              Effect.as(reply(input, "")),
            )
          }
          return Deferred.succeed(secondReady, undefined).pipe(Effect.andThen(Effect.never))
        },
      })

      const started = yield* def.execute(
        { description: "retain empty", prompt: "first", subagent_type: "general", async: true },
        context({ sessionID: chat.id, messageID: assistant.id, promptOps, attachment: parent }),
      )
      yield* Deferred.await(firstReady)
      const updated = yield* def.execute(
        {
          description: "retain empty update",
          prompt: "second",
          subagent_type: "general",
          task_id: started.metadata.sessionId,
        },
        context({ sessionID: chat.id, messageID: assistant.id, promptOps, attachment: parent }),
      )
      expect(updated.output).toContain("Async task updated")

      // Parks as a genuine unresolved entrant before the release that lets the gate publish.
      const settled = yield* parkedRead(parent, chat.id, "wrong fallback")
      yield* Deferred.succeed(firstRelease, undefined)
      yield* Deferred.await(secondReady)
      const cancelled = yield* jobs.cancel(started.metadata.sessionId)
      expect(cancelled?.status).toBe("cancelled")
      // A cancelled terminal carries no answer payload of its own. The answer the first run
      // completed stays retained, so it is still delivered rather than being folded into the
      // cancellation envelope as an inlined copy of itself.
      expect(cancelled?.output).toBeUndefined()

      const notification = yield* Deferred.await(injected)
      const text = notification.parts[0]
      expect(text?.type).toBe("text")
      if (text?.type === "text") {
        // The retained answer is delivered first, in conversation order, as its own envelope.
        expect(text.text).toContain(`state="completed"`)
        expect(text.text).toContain("final TextPart was absent")
      }
      expect(selectedText(yield* settled)).toBe("parent final")
      expect(parent.current()).toMatchObject({ attached: 0, undelivered: 0 })
      expect(parent.current().failed).toBe(false)
      // Two deliveries: the retained answer, then the cancellation envelope. Previously the answer
      // was inlined into the cancellation as a copy of itself and arrived as one prompt.
      expect(parentPrompts).toHaveLength(2)
      expect(parentPrompts[1]?.parts[0]).toMatchObject({ type: "text" })
      expect(yield* sessions.children(chat.id)).toHaveLength(1)
      yield* parent.close()
    }),
  )

  it.instance("a failing supplemental run terminalizes the root task with its own reason", () =>
    Effect.gen(function* () {
      const jobs = yield* BackgroundJob.Service
      const { chat, assistant } = yield* seed()
      const tool = yield* TaskTool
      const def = yield* tool.init()
      const firstReady = yield* Deferred.make<void>()
      const firstRelease = yield* Deferred.make<void>()
      const secondReady = yield* Deferred.make<void>()
      const injected = yield* Deferred.make<SessionPrompt.TaskPromptInput>()
      let childPrompts = 0
      // Explicit since C-5. This test previously reached `task.ts`'s `?? fallbackAttachments`
      // branch, so it ran against a private coordinator it had no handle on; the flag is on
      // file-wide, so `open` and `claim` were genuinely exercised against it. Constructing one here
      // preserves exactly that behaviour and makes the thing under test reachable.
      const coordinator = yield* AttachmentCoordinator.make
      const promptOps = basicOps({
        attachments: coordinator,
        prompt: (input) => {
          if (input.sessionID === chat.id)
            return Deferred.succeed(injected, input).pipe(Effect.as(reply(input, "done")))
          childPrompts += 1
          if (childPrompts === 1) {
            return Deferred.succeed(firstReady, undefined).pipe(
              Effect.andThen(Deferred.await(firstRelease)),
              Effect.as(reply(input, "")),
            )
          }
          return Deferred.succeed(secondReady, undefined).pipe(Effect.andThen(Effect.die(new Error("later boom"))))
        },
      })

      const started = yield* def.execute(
        { description: "root prior", prompt: "first", subagent_type: "general", async: true },
        context({ sessionID: chat.id, messageID: assistant.id, promptOps }),
      )
      yield* Deferred.await(firstReady)
      yield* def.execute(
        {
          description: "root prior update",
          prompt: "second",
          subagent_type: "general",
          task_id: started.metadata.sessionId,
        },
        context({ sessionID: chat.id, messageID: assistant.id, promptOps }),
      )
      yield* Deferred.succeed(firstRelease, undefined)
      yield* Deferred.await(secondReady)
      const result = yield* jobs.wait({ id: started.metadata.sessionId })
      expect(result.info?.status).toBe("error")
      // An error terminal carries no answer payload of its own.
      expect(result.info?.output).toBeUndefined()

      const notification = yield* Deferred.await(injected)
      const text = notification.parts[0]
      expect(text?.type).toBe("text")
      if (text?.type === "text") {
        // A supplemental run may now begin without waiting for the run before it, so this failure
        // lands while the owner is still in flight and the lifetime terminalizes with nothing filed.
        // The parent therefore receives the failure itself, carrying its own reason and no inlined
        // copy of any earlier output. Delivery of a retained answer ahead of a terminal is covered
        // by the attached-cancellation case above, which sequences the two explicitly.
        expect(text.text).toContain(`state="error"`)
        expect(text.text).toContain("later boom")
      }
    }),
  )

  it.instance("degradation before observer ownership routes the exact child through ordinary notification", () =>
    Effect.gen(function* () {
      const jobs = yield* BackgroundJob.Service
      const coordinator = yield* AttachmentCoordinator.make
      const { chat, assistant } = yield* seed()
      const parent = yield* coordinator.open(chat.id)
      const tool = yield* TaskTool
      const def = yield* tool.init()
      const childReady = yield* Deferred.make<void>()
      const childRelease = yield* Deferred.make<void>()
      const degraded = yield* Deferred.make<void>()
      const notified = yield* Deferred.make<SessionPrompt.TaskPromptInput>()
      const log = continuationLog()
      const parentPrompts: SessionPrompt.TaskPromptInput[] = []
      const attachments: AttachmentCoordinator.Interface = {
        ...coordinator,
        // Task claims after reserving the parent scope and before starting/attaching the child.
        // Degrading in this exact seam creates the pre-observer loss window deterministically.
        claim: (sessionID) =>
          coordinator.claim(sessionID).pipe(
            Effect.tap(() => parent.degrade()),
            Effect.tap(() => Deferred.succeed(degraded, undefined)),
          ),
      }
      const promptOps = continuationOps(
        recordingContinuationClosure(log),
        basicOps({
          attachments,
          prompt: (input) => {
            if (input.sessionID !== chat.id) {
              return Deferred.succeed(childReady, undefined).pipe(
                Effect.andThen(Deferred.await(childRelease)),
                Effect.as(reply(input, "terminal after pre-observer degradation")),
              )
            }
            parentPrompts.push(input)
            return Deferred.succeed(notified, input).pipe(Effect.as(reply(input, "ordinary parent continuation")))
          },
        }),
      )

      const started = yield* def.execute(
        { description: "pre-observer degradation", prompt: "run", subagent_type: "general", async: true },
        context({ sessionID: chat.id, messageID: assistant.id, promptOps, attachment: parent }),
      )
      yield* Deferred.await(degraded)
      yield* Deferred.await(childReady)
      expect(parent.current()).toMatchObject({ failed: true, cancelled: false, everAttached: false })
      const best = yield* parent.result(reply({ sessionID: chat.id, parts: [] }, "best evidence before observer"))
      expect(best).toMatchObject({ type: "evidence", degraded: true })
      expect(selectedText(best)).toBe("best evidence before observer")

      yield* Deferred.succeed(childRelease, undefined)
      expect((yield* jobs.wait({ id: started.metadata.sessionId })).info?.status).toBe("completed")
      const notification = yield* Deferred.await(notified)
      expect(notification.attachmentScope).toBeUndefined()
      expect(notification.parts.find((part) => part.type === "text")?.text).toContain(
        "terminal after pre-observer degradation",
      )
      yield* awaitSettled(log)
      expect(log.acquired).toHaveLength(1)
      expect(log.settled).toHaveLength(1)
      expect(parentPrompts).toHaveLength(1)
      yield* parent.close()
    }),
  )

  it.instance("degraded same-ID reservations elect one exact fallback observer and one parent prompt", () =>
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const jobs = yield* BackgroundJob.Service
      const coordinator = yield* AttachmentCoordinator.make
      const { chat, assistant } = yield* seed()
      const parent = yield* coordinator.open(chat.id)
      const firstClaimEntered = yield* Deferred.make<void>()
      const releaseFirstClaim = yield* Deferred.make<void>()
      const secondReserved = yield* Deferred.make<void>()
      const firstReady = yield* Deferred.make<void>()
      const firstRelease = yield* Deferred.make<void>()
      const secondReady = yield* Deferred.make<void>()
      const secondRelease = yield* Deferred.make<void>()
      const notified = yield* Deferred.make<SessionPrompt.TaskPromptInput>()
      const log = continuationLog()
      let reservations = 0
      let observerClaims = 0
      let exactWaits = 0
      let childPrompts = 0
      const parentPrompts: SessionPrompt.TaskPromptInput[] = []

      const attachment: AttachmentCoordinator.Scope = {
        ...parent,
        reserve: (jobID) =>
          Effect.gen(function* () {
            const reservation = yield* parent.reserve(jobID)
            reservations++
            if (reservations === 2) yield* Deferred.succeed(secondReserved, undefined)
            return reservation
          }),
        claimObserver: (reservation) =>
          Effect.gen(function* () {
            observerClaims++
            if (observerClaims === 1) {
              yield* Deferred.succeed(firstClaimEntered, undefined)
              yield* Deferred.await(releaseFirstClaim)
            }
            return yield* parent.claimObserver(reservation)
          }),
      }
      const attachments: AttachmentCoordinator.Interface = {
        ...coordinator,
        locate: (sessionID) => (sessionID === chat.id ? Effect.succeed(attachment) : coordinator.locate(sessionID)),
      }
      const instrumented: BackgroundJob.Interface = {
        ...jobs,
        waitHandle: (input) => Effect.sync(() => void (exactWaits += 1)).pipe(Effect.andThen(jobs.waitHandle(input))),
      }
      const tool = yield* TaskTool.pipe(Effect.provideService(BackgroundJob.Service, instrumented))
      const def = yield* tool.init()
      const promptOps = continuationOps(
        recordingContinuationClosure(log),
        basicOps({
          attachments,
          prompt: (input) => {
            if (input.sessionID === chat.id) {
              parentPrompts.push(input)
              return Deferred.succeed(notified, input).pipe(Effect.as(reply(input, "ordinary degraded continuation")))
            }
            childPrompts++
            if (childPrompts === 1) {
              return Deferred.succeed(firstReady, undefined).pipe(
                Effect.andThen(Deferred.await(firstRelease)),
                Effect.as(reply(input, "first invocation")),
              )
            }
            return Deferred.succeed(secondReady, undefined).pipe(
              Effect.andThen(Deferred.await(secondRelease)),
              Effect.as(reply(input, "second invocation")),
            )
          },
        }),
      )
      const caller = context({ sessionID: chat.id, messageID: assistant.id, promptOps, attachment })

      const first = yield* def
        .execute(
          { description: "degraded cohort owner", prompt: "first", subagent_type: "general", async: true },
          caller,
        )
        .pipe(Effect.forkChild)
      yield* Deferred.await(firstClaimEntered)
      yield* Deferred.await(firstReady)
      const child = (yield* sessions.children(chat.id))[0]
      if (!child) return yield* Effect.die("missing degraded cohort child")

      const second = yield* def
        .execute(
          {
            description: "degraded cohort extension",
            prompt: "second",
            subagent_type: "general",
            task_id: child.id,
            async: true,
          },
          caller,
        )
        .pipe(Effect.forkChild)
      yield* Deferred.await(secondReserved)

      // Both same-ID reservations exist before either observer claim reaches the coordinator.
      expect(reservations).toBe(2)
      expect(parent.current()).toMatchObject({ attached: 1, everAttached: false })
      yield* parent.degrade()
      yield* Deferred.succeed(releaseFirstClaim, undefined)
      yield* Fiber.join(first)
      yield* Fiber.join(second)

      yield* Deferred.succeed(firstRelease, undefined)
      yield* Deferred.await(secondReady)
      yield* Deferred.succeed(secondRelease, undefined)
      // Observer-owned, so the answer was published for the observer to take and the terminal keeps
      // no inline payload of its own.
      const settled = yield* jobs.wait({ id: child.id })
      expect(settled.info?.status).toBe("completed")
      expect(settled.info?.output).toBeUndefined()
      const notification = yield* Deferred.await(notified)
      yield* awaitSettled(log)

      expect(observerClaims).toBe(2)
      // Two exact waits, one observer. The first is the elected fallback observer's; the second is
      // the lifetime-bound release of the owner attachment scope, which reads the same handle purely
      // to learn when the child ends. Only the owner invocation opens a scope, so it contributes
      // exactly one such read and extensions contribute none. One OBSERVER is asserted by the claim
      // count and the single acquired/settled continuation lease below.
      expect(exactWaits).toBe(2)
      expect(log.acquired).toHaveLength(1)
      expect(log.settled).toHaveLength(1)
      // Both answers are delivered, in conversation order, through the one elected observer.
      expect(parentPrompts).toHaveLength(2)
      expect(parentPrompts[0]).toBe(notification)
      expect(notification.attachmentScope).toBeUndefined()
      expect(parentPrompts[1]?.parts.find((part) => part.type === "text")?.text).toContain("second invocation")
      expect(parent.current()).toMatchObject({ failed: true, everAttached: false })
      yield* parent.close()
    }),
  )

  it.instance("a degraded attached observer routes its terminal through ordinary upstream notification", () =>
    Effect.gen(function* () {
      const jobs = yield* BackgroundJob.Service
      const coordinator = yield* AttachmentCoordinator.make
      const { chat, assistant } = yield* seed()
      const parent = yield* coordinator.open(chat.id)
      const tool = yield* TaskTool
      const def = yield* tool.init()
      const childReady = yield* Deferred.make<void>()
      const childRelease = yield* Deferred.make<void>()
      const notified = yield* Deferred.make<SessionPrompt.TaskPromptInput>()
      const parentPrompts: SessionPrompt.TaskPromptInput[] = []
      const promptOps = basicOps({
        attachments: coordinator,
        prompt: (input) => {
          if (input.sessionID !== chat.id) {
            return Deferred.succeed(childReady, undefined).pipe(
              Effect.andThen(Deferred.await(childRelease)),
              Effect.as(reply(input, "terminal result after attachment degradation")),
            )
          }
          parentPrompts.push(input)
          return Deferred.succeed(notified, input).pipe(Effect.as(reply(input, "ordinary parent continuation")))
        },
      })

      const started = yield* def.execute(
        { description: "degraded delivery", prompt: "run", subagent_type: "general", async: true },
        context({ sessionID: chat.id, messageID: assistant.id, promptOps, attachment: parent }),
      )
      yield* Deferred.await(childReady)
      expect((yield* jobs.get(started.metadata.sessionId))?.status).toBe("running")

      yield* parent.degrade()
      const bestResult = yield* parent
        .result(reply({ sessionID: chat.id, parts: [] }, "best evidence before terminal"))
        .pipe(Effect.forkChild)

      yield* Deferred.succeed(childRelease, undefined)
      const terminal = yield* jobs.wait({ id: started.metadata.sessionId })
      expect(terminal.info?.status).toBe("completed")
      const notification = yield* Deferred.await(notified)
      const best = yield* Fiber.join(bestResult)
      expect(best).toMatchObject({ type: "evidence", degraded: true })
      expect(selectedText(best)).toBe("best evidence before terminal")
      expect(notification.attachmentScope).toBeUndefined()
      const text = notification.parts.find((part) => part.type === "text")
      expect(text?.text).toContain("terminal result after attachment degradation")
      expect(parentPrompts).toHaveLength(1)
      yield* parent.close()
    }),
  )

  it.instance("the one observer stays bound to its exact handle after same-ID replacement", () =>
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const jobs = yield* BackgroundJob.Service
      const coordinator = yield* AttachmentCoordinator.make
      const { chat, assistant } = yield* seed()
      const parent = yield* coordinator.open(chat.id)
      const tool = yield* TaskTool
      const def = yield* tool.init()
      const childReady = yield* Deferred.make<void>()
      const childRelease = yield* Deferred.make<void>()
      const acquireEntered = yield* Deferred.make<void>()
      const acquireRelease = yield* Deferred.make<void>()
      const notified = yield* Deferred.make<SessionPrompt.TaskPromptInput>()
      const log = continuationLog()
      const recording = recordingContinuationClosure(log)
      let acquisitions = 0
      const closure: SessionClosure.Interface = {
        ...recording,
        acquire: (input) =>
          Effect.gen(function* () {
            acquisitions++
            yield* Deferred.succeed(acquireEntered, undefined)
            yield* Deferred.await(acquireRelease)
            return yield* recording.acquire(input)
          }),
      }
      const parentPrompts: SessionPrompt.TaskPromptInput[] = []
      const original = "ORIGINAL invocation terminal"
      const replacementOutput = "REPLACEMENT occupant terminal"
      const promptOps = continuationOps(
        closure,
        basicOps({
          attachments: coordinator,
          prompt: (input) => {
            if (input.sessionID !== chat.id) {
              return Deferred.succeed(childReady, undefined).pipe(
                Effect.andThen(Deferred.await(childRelease)),
                Effect.as(reply(input, original)),
              )
            }
            parentPrompts.push(input)
            return Deferred.succeed(notified, input).pipe(Effect.andThen(admit(input, "parent final")))
          },
        }),
      )

      const execution = yield* def
        .execute(
          { description: "same-ID handle ABA", prompt: "run", subagent_type: "general", async: true },
          context({ sessionID: chat.id, messageID: assistant.id, promptOps, attachment: parent }),
        )
        .pipe(Effect.forkChild)
      yield* Deferred.await(childReady)
      yield* Deferred.await(acquireEntered)
      const child = (yield* sessions.children(chat.id))[0]
      if (!child) return yield* Effect.die("missing child")
      // Parks as a genuine unresolved entrant before the release that lets the gate publish.
      const settled = yield* parkedRead(parent, chat.id, "wrong fallback")
      yield* Deferred.succeed(childRelease, undefined)
      const originalTerminal = yield* jobs.wait({ id: child.id })
      expect(originalTerminal.info?.status).toBe("completed")
      // Observer-owned: the answer is published rather than stored on the terminal.
      expect(originalTerminal.info?.output).toBeUndefined()

      // The observer lease is held before its exact wait. Put a fresh lifetime under the same public
      // id now: an id-based observer reads this replacement, while waitHandle retains the original.
      const replacement = yield* jobs.startExact({
        id: child.id,
        type: "task",
        title: "same public ID replacement",
        run: Effect.succeed(answered("m_replacement", 900, replacementOutput)),
        admission: { lease: "lease_task_fallback_replacement", epoch: 0n },
      })
      if (!replacement.handle) return yield* Effect.die("replacement did not arm")
      const replacementTerminal = yield* jobs.waitHandle({ handle: replacement.handle })
      expect(replacementTerminal.info?.output).toBe(replacementOutput)

      yield* Deferred.succeed(acquireRelease, undefined)
      yield* Fiber.join(execution)
      const notification = yield* Deferred.await(notified)
      const text = notification.parts.find((part) => part.type === "text")
      expect(text?.text).toContain(original)
      expect(text?.text).not.toContain(replacementOutput)
      expect(notification.attachmentScope).toBe(parent)
      expect(selectedText(yield* settled)).toBe("parent final")
      yield* awaitSettled(log)
      expect(acquisitions).toBe(1)
      expect(parentPrompts).toEqual([notification])
      yield* parent.close()
    }),
  )

  it.instance("explicit cancellation still suppresses fallback after an earlier degradation", () =>
    Effect.gen(function* () {
      const jobs = yield* BackgroundJob.Service
      const coordinator = yield* AttachmentCoordinator.make
      const { chat, assistant } = yield* seed()
      const parent = yield* coordinator.open(chat.id)
      const tool = yield* TaskTool
      const def = yield* tool.init()
      const childReady = yield* Deferred.make<void>()
      const childRelease = yield* Deferred.make<void>()
      const log = continuationLog()
      let parentPrompts = 0
      const promptOps = continuationOps(
        recordingContinuationClosure(log),
        basicOps({
          attachments: coordinator,
          prompt: (input) => {
            if (input.sessionID !== chat.id) {
              return Deferred.succeed(childReady, undefined).pipe(
                Effect.andThen(Deferred.await(childRelease)),
                Effect.as(reply(input, "terminal result after explicit cancellation")),
              )
            }
            parentPrompts++
            return Effect.die("explicit cancellation must suppress parent notification")
          },
        }),
      )

      const started = yield* def.execute(
        { description: "cancelled degraded delivery", prompt: "run", subagent_type: "general", async: true },
        context({ sessionID: chat.id, messageID: assistant.id, promptOps, attachment: parent }),
      )
      yield* Deferred.await(childReady)
      yield* parent.degrade()
      yield* parent.claimCancellation("cancelled")
      const result = yield* parent.result(reply({ sessionID: chat.id, parts: [] }, "unused")).pipe(Effect.forkChild)
      expect(parent.current()).toMatchObject({ failed: true, cancelled: true })

      yield* Deferred.succeed(childRelease, undefined)
      expect((yield* jobs.wait({ id: started.metadata.sessionId })).info?.status).toBe("completed")
      yield* awaitSettled(log)
      expect(yield* Fiber.join(result)).toMatchObject({ type: "cancelled", status: "cancelled" })
      for (let attempt = 0; attempt < 1000; attempt++) yield* Effect.yieldNow

      // The one attached observer settles, but cancellation prevents an ordinary fallback from
      // acquiring a second continuation lease or reaching the parent prompt.
      expect(log.acquired).toHaveLength(1)
      expect(log.settled).toHaveLength(1)
      expect(parentPrompts).toBe(0)
      yield* parent.close()
    }),
  )

  it.instance("degradation during a held parent prompt produces one continuation and no retry", () =>
    Effect.gen(function* () {
      const coordinator = yield* AttachmentCoordinator.make
      const { chat, assistant } = yield* seed()
      const parent = yield* coordinator.open(chat.id)
      const tool = yield* TaskTool
      const def = yield* tool.init()
      const promptStarted = yield* Deferred.make<SessionPrompt.TaskPromptInput>()
      const promptRelease = yield* Deferred.make<void>()
      const parentPrompts: SessionPrompt.TaskPromptInput[] = []
      const log = continuationLog()
      const promptOps = continuationOps(
        recordingContinuationClosure(log),
        basicOps({
          attachments: coordinator,
          prompt: (input) => {
            if (input.sessionID !== chat.id) return Effect.succeed(reply(input, "terminal result"))
            parentPrompts.push(input)
            return persist(input).pipe(
              Effect.andThen(Deferred.succeed(promptStarted, input)),
              Effect.andThen(Deferred.await(promptRelease)),
              Effect.as(reply(input, "held parent response")),
            )
          },
        }),
      )

      yield* def.execute(
        { description: "single path degradation", prompt: "run", subagent_type: "general", async: true },
        context({ sessionID: chat.id, messageID: assistant.id, promptOps, attachment: parent }),
      )
      const notification = yield* Deferred.await(promptStarted)
      expect(parent.current()).toMatchObject({ undelivered: 1, candidate: false })
      const caller = yield* parent
        .result(reply({ sessionID: chat.id, parts: [] }, "best evidence during held prompt"))
        .pipe(Effect.forkChild)
      yield* parent.degrade()
      expect(parentPrompts).toHaveLength(1)
      yield* Deferred.succeed(promptRelease, undefined)

      const returned = yield* Fiber.join(caller)
      expect(returned).toMatchObject({ type: "evidence", degraded: true })
      expect(selectedText(returned)).toBe("best evidence during held prompt")
      expect(notification.attachmentScope).toBe(parent)
      expect(parent.current().undelivered).toBe(0)
      yield* awaitSettled(log)
      expect(log.acquired).toHaveLength(1)
      expect(log.settled).toHaveLength(1)
      expect(parentPrompts).toEqual([notification])
      yield* parent.close()
    }),
  )

  it.instance("a synchronous terminal error reports its own reason without inlining a retained answer", () =>
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const { chat, assistant } = yield* seed()
      const tool = yield* TaskTool
      const def = yield* tool.init()
      const firstReady = yield* Deferred.make<void>()
      const firstRelease = yield* Deferred.make<void>()
      const secondReady = yield* Deferred.make<void>()
      const parentPrompts: SessionPrompt.TaskPromptInput[] = []
      let childPrompts = 0
      // Explicit since C-5; see the sibling test above for why the fallback made this implicit.
      const coordinator = yield* AttachmentCoordinator.make
      const promptOps = basicOps({
        attachments: coordinator,
        prompt: (input) => {
          if (input.sessionID === chat.id) {
            parentPrompts.push(input)
            return Effect.succeed(reply(input, "unexpected"))
          }
          childPrompts += 1
          if (childPrompts === 1) {
            return Deferred.succeed(firstReady, undefined).pipe(
              Effect.andThen(Deferred.await(firstRelease)),
              Effect.as(reply(input, "")),
            )
          }
          return Deferred.succeed(secondReady, undefined).pipe(Effect.andThen(Effect.die(new Error("sync later boom"))))
        },
      })

      const foreground = yield* def
        .execute(
          { description: "sync prior", prompt: "first", subagent_type: "general" },
          context({ sessionID: chat.id, messageID: assistant.id, promptOps }),
        )
        .pipe(Effect.forkChild)
      yield* Deferred.await(firstReady)
      const child = (yield* sessions.children(chat.id))[0]
      if (!child) return yield* Effect.die("missing child")
      const updated = yield* def.execute(
        {
          description: "sync prior update",
          prompt: "second",
          subagent_type: "general",
          task_id: child.id,
        },
        context({ sessionID: chat.id, messageID: assistant.id, promptOps }),
      )
      expect(updated.output).toContain("Async task updated")
      yield* Deferred.succeed(firstRelease, undefined)
      yield* Deferred.await(secondReady)

      const exit = yield* Fiber.await(foreground)
      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        const error = Cause.squash(exit.cause)
        const message = error instanceof Error ? error.message : String(error)
        // The failure carries the terminal's own reason and nothing else. The answer the earlier run
        // completed is not joined into it - it stays retained in the task session, which the caller
        // reaches through the task_id it necessarily already holds.
        expect(message).toBe("sync later boom")
      }
      expect(parentPrompts).toHaveLength(0)
    }),
  )

  it.instance("an unpromoted synchronous cancellation finalizes its owner scope as cancelled", () =>
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const jobs = yield* BackgroundJob.Service
      const runState = yield* SessionRunState.Service
      const coordinator = yield* AttachmentCoordinator.make
      const { chat, assistant } = yield* seed()
      const tool = yield* TaskTool
      const def = yield* tool.init()
      const resultEntered = yield* Deferred.make<void>()
      const firstResultDone = yield* Deferred.make<void>()
      const laterOwned = yield* Deferred.make<void>()
      const owner: { scope?: AttachmentCoordinator.Scope; earlier?: SessionV1.WithParts } = {}
      const finalizers = { cancellations: 0, closes: 0 }
      const wrapped = new Map<SessionID, AttachmentCoordinator.Scope>()
      let resultCalls = 0
      let ownerClosed = false
      let finalizedScopeReads = 0

      const wrap = (scope: AttachmentCoordinator.Scope) => {
        const instrumented: AttachmentCoordinator.Scope = {
          ...scope,
          current: () => {
            if (ownerClosed) finalizedScopeReads++
            return scope.current()
          },
          claimCancellation: (status) =>
            Effect.sync(() => void finalizers.cancellations++).pipe(Effect.andThen(scope.claimCancellation(status))),
          close: () =>
            scope.close().pipe(
              Effect.tap(() =>
                Effect.sync(() => {
                  finalizers.closes++
                  ownerClosed = true
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
      const attachments: AttachmentCoordinator.Interface = {
        ...coordinator,
        open: (sessionID) => coordinator.open(sessionID).pipe(Effect.map(wrap)),
        locate: (sessionID) =>
          coordinator
            .locate(sessionID)
            .pipe(Effect.map((scope) => (scope ? (wrapped.get(sessionID) ?? scope) : scope))),
        locateBorrowable: (sessionID) =>
          coordinator
            .locateBorrowable(sessionID)
            .pipe(Effect.map((scope) => (scope ? (wrapped.get(sessionID) ?? scope) : scope))),
      }

      const staleText = "SYNC K14 earlier successful Assistant"
      let childPrompts = 0
      const promptOps = basicOps({
        attachments,
        prompt: (input) =>
          Effect.gen(function* () {
            if (input.sessionID === chat.id) return yield* Effect.die("unpromoted sync cancellation injected parent")
            childPrompts++
            if (childPrompts === 1) {
              if (!input.attachmentScope) return yield* Effect.die("sync owner run had no attachment scope")
              yield* input.attachmentScope.reserve(SessionID.create())
              return yield* admit(input, staleText)
            }
            if (childPrompts !== 2) return yield* Effect.die("unexpected sync cancellation child run")
            yield* persist(input)
            yield* Deferred.succeed(laterOwned, undefined)
            return yield* Effect.never
          }),
      })

      const foreground = yield* def
        .execute(
          { description: "sync cancellation owner", prompt: "first", subagent_type: "general" },
          context({ sessionID: chat.id, messageID: assistant.id, promptOps }),
        )
        .pipe(Effect.forkChild)
      yield* Deferred.await(resultEntered)

      const child = (yield* sessions.children(chat.id))[0]
      const scope = owner.scope
      const earlier = owner.earlier
      if (!child || !scope || !earlier) return yield* Effect.die("sync cancellation owner did not park")
      expect(scope.current()).toMatchObject({ attached: 1, candidate: true, failed: false, cancelled: false })
      expect(yield* Deferred.isDone(firstResultDone)).toBe(false)

      const supplement = yield* def.execute(
        {
          description: "sync cancellation later",
          prompt: "later",
          subagent_type: "general",
          task_id: child.id,
        },
        context({ sessionID: chat.id, messageID: assistant.id, promptOps }),
      )
      expect(supplement.output).toContain("task updated")
      yield* Deferred.await(laterOwned)
      expect(scope.current().candidate).toBe(false)

      // The product Session cancellation path exact-cancels the Task BackgroundJob. No fixture calls
      // the coordinator finalizer; the foreground Task cancellation branch must project the terminal.
      yield* runState.cancel(child.id)
      const terminal = yield* jobs.wait({ id: child.id, timeout: 5_000 })
      expect(terminal.timedOut).toBe(false)
      expect(terminal.info?.status).toBe("cancelled")
      expect(Object.hasOwn(terminal.info ?? {}, "cancellationStatus")).toBe(false)

      const returned = yield* Fiber.join(foreground)
      expect(resultCalls).toBe(1)
      expect(finalizedScopeReads).toBe(0)
      expect(count(returned.output, 'state="cancelled"')).toBe(1)
      expect(count(returned.output, "task_evidence=")).toBe(1)
      expect(returned.output).toContain("status: unknown")
      expect(returned.output).toContain(`task_evidence=${JSON.stringify({ task_id: child.id, status: "unknown" })}`)
      expect(returned.output).not.toContain("status: cancelled")
      expect(returned.output).not.toContain('state="error"')
      expect(returned.output).not.toContain("Task failed")
      expect(returned.output).not.toContain(staleText)
      expect(returned.output).not.toContain(earlier.info.id)

      // SAME earlier ID: a fresh probe would legitimately bypass the published evidence under
      // Admission Freshness and would not discriminate cancellation from degraded stale replay.
      const selected = yield* scope.result(earlier)
      expect(selected).toMatchObject({ type: "cancelled", status: "cancelled" })
      expect("fallback" in selected).toBe(false)
      expect(JSON.stringify(selected)).not.toContain(staleText)
      expect(JSON.stringify(selected)).not.toContain(earlier.info.id)
      expect(resultCalls).toBe(2)

      // The explicit cancellation finalizer wins exactly once. acquire-release later observes a
      // successful Tool return, but the holder makes that success-shaped backstop a no-op.
      expect(finalizers).toEqual({ cancellations: 1, closes: 1 })
      expect(yield* Deferred.isDone(firstResultDone)).toBe(true)
    }),
  )

  it.instance("adjacent invocations keep one observer and one parent prompt", () =>
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const jobs = yield* BackgroundJob.Service
      const coordinator = yield* AttachmentCoordinator.make
      const { chat, assistant } = yield* seed()
      const parent = yield* coordinator.open(chat.id)
      const tool = yield* TaskTool
      const def = yield* tool.init()
      const firstReady = yield* Deferred.make<void>()
      const firstRelease = yield* Deferred.make<void>()
      const secondReady = yield* Deferred.make<void>()
      const secondRelease = yield* Deferred.make<void>()
      const injected = yield* Deferred.make<SessionPrompt.TaskPromptInput>()
      const parentPrompts: SessionPrompt.TaskPromptInput[] = []
      let childPrompts = 0
      const promptOps = basicOps({
        attachments: coordinator,
        prompt: (input) => {
          if (input.sessionID === chat.id) {
            parentPrompts.push(input)
            return Deferred.succeed(injected, input).pipe(Effect.andThen(admit(input, "parent promoted final")))
          }
          childPrompts += 1
          if (childPrompts === 1) {
            return Deferred.succeed(firstReady, undefined).pipe(
              Effect.andThen(Deferred.await(firstRelease)),
              Effect.as(reply(input, "first")),
            )
          }
          return Deferred.succeed(secondReady, undefined).pipe(
            Effect.andThen(Deferred.await(secondRelease)),
            Effect.as(reply(input, "second")),
          )
        },
      })
      const foreground = yield* def
        .execute(
          { description: "foreground owner", prompt: "first", subagent_type: "general" },
          context({ sessionID: chat.id, messageID: assistant.id, promptOps, attachment: parent }),
        )
        .pipe(Effect.forkChild)
      yield* Deferred.await(firstReady)
      const child = (yield* sessions.children(chat.id))[0]
      if (!child) return yield* Effect.die("missing child")

      const updated = yield* def.execute(
        {
          description: "foreground extension",
          prompt: "second",
          subagent_type: "general",
          task_id: child.id,
        },
        context({ sessionID: chat.id, messageID: assistant.id, promptOps, attachment: parent }),
      )
      expect(updated.output).toContain("Async task updated")
      // Parks as a genuine unresolved entrant before the releases that let the gate publish.
      const settled = yield* parkedRead(parent, chat.id, "wrong fallback")
      const promoted = yield* Fiber.join(foreground)
      expect(promoted.metadata.background).toBe(true)
      expect(promoted.output).toContain("Async task started")

      yield* Deferred.succeed(firstRelease, undefined)
      yield* Deferred.await(secondReady)
      yield* Deferred.succeed(secondRelease, undefined)
      // Observer-owned: no inline payload on the terminal. What the parent actually receives is
      // asserted below, which is where the rendered envelope belongs.
      const adjacentTerminal = yield* jobs.wait({ id: child.id })
      expect(adjacentTerminal.info?.status).toBe("completed")
      expect(adjacentTerminal.info?.output).toBeUndefined()
      const notification = yield* Deferred.await(injected)
      const part = notification.parts[0]
      expect(part?.type).toBe("text")
      if (part?.type === "text") {
        // Answers deliver in conversation order, so the first one the parent receives is the answer
        // the first invocation produced - not whichever run settled last. It completed while the
        // supplemental run was still registered, so it also carries the outstanding-work notice,
        // which is what tells the caller a further answer may still arrive.
        expect(part.text).toContain("<task_result>\nfirst\n</task_result>")
        expect(part.text).toContain("Any further answer it produces will be delivered separately.")
        expect(part.text).not.toContain("<summary>")
      }
      expect(selectedText(yield* settled)).toBe("parent promoted final")

      // POSITIVE PRODUCTION TOPOLOGY: both actual Task prompts ran against one physical Lifetime,
      // and sequence zero plus its adjacent extension are accepted before any identity assertion.
      const exact = yield* jobs.listExact()
      expect(exact).toHaveLength(1)
      expect(exact[0]?.state).toBe("terminal")
      const lifetime = exact[0]?.lifetime
      if (!lifetime) return yield* Effect.die("missing physical lifetime")
      expect((yield* jobs.observe({ lifetime, sequence: 0 }))?.accepted).toBe(true)
      expect((yield* jobs.observe({ lifetime, sequence: 1 }))?.accepted).toBe(true)
      expect((yield* jobs.observe({ lifetime, sequence: 2 }))?.accepted).toBe(false)

      // Two child runs produced two answers, so the one observer makes two ordered deliveries.
      // Previously the earlier answer was overwritten and only one delivery ever occurred.
      expect(parentPrompts).toHaveLength(2)
      expect(childPrompts).toBe(2)
      expect(notification.attachmentScope).toBe(parent)
      expect(parent.needsWake()).toBe(false)
      expect(parent.current()).toMatchObject({ attached: 0, undelivered: 0, failed: false })
      // The former per-sequence delivery-ack clause is superseded with its retired ledger. This row
      // now guards the retained adjacent-invocation invariant only: one lifetime, one observer, one
      // ordinary parent prompt, and no duplicate caller return.
      yield* parent.close()
    }),
  )

  it.instance("a late same-cohort extension cannot re-elect after the first observer settles U", () =>
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const jobs = yield* BackgroundJob.Service
      const coordinator = yield* AttachmentCoordinator.make
      const { chat, assistant } = yield* seed()
      const parent = yield* coordinator.open(chat.id)
      const secondClaimEntered = yield* Deferred.make<void>()
      const releaseSecondClaim = yield* Deferred.make<void>()
      const lateClaimed = yield* Deferred.make<AttachmentCoordinator.ObserverClaim["type"]>()
      const firstReady = yield* Deferred.make<void>()
      const firstRelease = yield* Deferred.make<void>()
      const secondReady = yield* Deferred.make<void>()
      const secondRelease = yield* Deferred.make<void>()
      const promptStarted = yield* Deferred.make<SessionPrompt.TaskPromptInput>()
      const promptRelease = yield* Deferred.make<void>()
      const promptFinished = yield* Deferred.make<void>()
      const terminalSettled = yield* Deferred.make<void>()
      const releaseSettlement = yield* Deferred.make<void>()
      const log = continuationLog()
      const parentPrompts: SessionPrompt.TaskPromptInput[] = []
      let observerClaims = 0
      let exactWaits = 0
      let childPrompts = 0

      const attachment: AttachmentCoordinator.Scope = {
        ...parent,
        claimObserver: (reservation) =>
          Effect.gen(function* () {
            const position = ++observerClaims
            if (position === 2) {
              yield* Deferred.succeed(secondClaimEntered, undefined)
              yield* Deferred.await(releaseSecondClaim)
            }
            const claim = yield* parent.claimObserver(reservation)
            if (position === 2) yield* Deferred.succeed(lateClaimed, claim.type)
            return claim
          }),
        settleTerminal: (terminal) =>
          Effect.gen(function* () {
            yield* parent.settleTerminal(terminal)
            yield* Deferred.succeed(terminalSettled, undefined)
            yield* Deferred.await(releaseSettlement)
          }),
      }
      const attachments: AttachmentCoordinator.Interface = {
        ...coordinator,
        locate: (sessionID) => (sessionID === chat.id ? Effect.succeed(attachment) : coordinator.locate(sessionID)),
      }
      const instrumented: BackgroundJob.Interface = {
        ...jobs,
        waitHandle: (input) => Effect.sync(() => void (exactWaits += 1)).pipe(Effect.andThen(jobs.waitHandle(input))),
      }
      const tool = yield* TaskTool.pipe(Effect.provideService(BackgroundJob.Service, instrumented))
      const def = yield* tool.init()
      const promptOps = continuationOps(
        recordingContinuationClosure(log),
        basicOps({
          attachments,
          prompt: (input) =>
            Effect.gen(function* () {
              if (input.sessionID !== chat.id) {
                childPrompts++
                if (childPrompts === 1) {
                  yield* Deferred.succeed(firstReady, undefined)
                  yield* Deferred.await(firstRelease)
                  return reply(input, "first invocation")
                }
                yield* Deferred.succeed(secondReady, undefined)
                yield* Deferred.await(secondRelease)
                return reply(input, "second invocation")
              }
              parentPrompts.push(input)
              // Two answers means two deliveries through the one elected observer. The invariant this
              // test guards is a single OBSERVER - asserted by observerClaims/exactWaits/log.acquired
              // below - which is no longer the same thing as a single parent prompt.
              if (parentPrompts.length > 1) return yield* admit(input, "later answer delivery")
              yield* Deferred.succeed(promptStarted, input)
              yield* Deferred.await(promptRelease)
              const response = yield* admit(input, "sole parent final")
              yield* Deferred.succeed(promptFinished, undefined)
              return response
            }),
        }),
      )
      const caller = context({ sessionID: chat.id, messageID: assistant.id, promptOps, attachment })

      const started = yield* def.execute(
        { description: "late cohort owner", prompt: "first", subagent_type: "general", async: true },
        caller,
      )
      yield* Deferred.await(firstReady)
      const child = (yield* sessions.children(chat.id))[0]
      if (!child) return yield* Effect.die("missing late-cohort child")

      const extension = yield* def
        .execute(
          {
            description: "late cohort extension",
            prompt: "second",
            subagent_type: "general",
            task_id: child.id,
            async: true,
          },
          caller,
        )
        .pipe(Effect.forkChild)
      yield* Deferred.await(secondClaimEntered)

      // Parks as a genuine unresolved entrant before the releases that let the gate publish.
      const settled = yield* parkedRead(parent, chat.id, "wrong fallback")
      yield* Deferred.succeed(firstRelease, undefined)
      yield* Deferred.await(secondReady)
      yield* Deferred.succeed(secondRelease, undefined)
      // Observer-owned: the answer is published for the observer, not stored on the terminal.
      const cohortTerminal = yield* jobs.wait({ id: started.metadata.sessionId })
      expect(cohortTerminal.info?.status).toBe("completed")
      expect(cohortTerminal.info?.output).toBeUndefined()

      const notification = yield* Deferred.await(promptStarted)
      expect(parent.current()).toMatchObject({ attached: 0, undelivered: 1, failed: false })
      yield* Deferred.succeed(promptRelease, undefined)
      yield* Deferred.await(promptFinished)
      yield* Deferred.await(terminalSettled)
      expect(parent.current()).toMatchObject({ attached: 0, undelivered: 0, candidate: true, failed: false })

      // R2 was issued while R1 still occupied J, but reaches election only after R1 has moved J -> U,
      // finished its one parent prompt, and settled U. The retained token must classify it existing.
      yield* Deferred.succeed(releaseSecondClaim, undefined)
      expect(yield* Deferred.await(lateClaimed)).toBe("existing")
      yield* Fiber.join(extension)
      yield* Deferred.succeed(releaseSettlement, undefined)
      yield* awaitSettled(log)

      // The second answer's delivery is the later evidence, so selection resolves to its reply
      // rather than the first one's. The single-observer invariants below are this test's subject.
      expect(selectedText(yield* settled)).toBe("later answer delivery")
      expect(observerClaims).toBe(2)
      // Three exact waits, one observer. The blocking wait is the observer's; the second is the
      // supplemental prompt's receipt reading the accepted lifetime's own record with a zero
      // timeout, which is what keys that receipt to the lifetime actually admitted rather than to
      // whichever one currently holds the public id; the third is the lifetime-bound release of the
      // owner attachment scope, which reads the same handle purely to learn when the child ends.
      // Only the owner invocation opens a scope, so it contributes exactly one such read and
      // extensions contribute none. One OBSERVER is asserted by the claim count and the single
      // acquired/settled continuation lease below.
      expect(exactWaits).toBe(3)
      expect(log.acquired).toHaveLength(1)
      expect(log.settled).toHaveLength(1)
      expect(parentPrompts).toHaveLength(2)
      expect(parentPrompts[0]).toBe(notification)
      expect(notification.attachmentScope).toBe(attachment)
      expect(parent.current().failed).toBe(false)
      yield* parent.close()
    }),
  )

  it.instance("concurrent same-ID starts execute every prompt exactly once as owner plus extension", () =>
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const jobs = yield* BackgroundJob.Service
      const { chat, assistant } = yield* seed()
      const child = yield* sessions.create({ parentID: chat.id, title: "Concurrent child", agent: "general" })
      const tool = yield* TaskTool
      const def = yield* tool.init()
      const firstReady = yield* Deferred.make<void>()
      const firstRelease = yield* Deferred.make<void>()
      const secondReady = yield* Deferred.make<void>()
      const secondRelease = yield* Deferred.make<void>()
      let prompts = 0
      let notifications = 0
      // Explicit since C-5; see the sibling tests above for why the fallback made this implicit.
      const coordinator = yield* AttachmentCoordinator.make
      const promptOps = basicOps({
        attachments: coordinator,
        prompt: (input) => {
          if (input.sessionID === chat.id) {
            notifications += 1
            return Effect.succeed(reply(input, "notified"))
          }
          prompts += 1
          if (prompts === 1) {
            return Deferred.succeed(firstReady, undefined).pipe(
              Effect.andThen(Deferred.await(firstRelease)),
              Effect.as(reply(input, "first")),
            )
          }
          return Deferred.succeed(secondReady, undefined).pipe(
            Effect.andThen(Deferred.await(secondRelease)),
            Effect.as(reply(input, "second")),
          )
        },
      })
      const execute = (prompt: string) =>
        def.execute(
          {
            description: `concurrent ${prompt}`,
            prompt,
            subagent_type: "general",
            task_id: child.id,
            async: true,
          },
          context({ sessionID: chat.id, messageID: assistant.id, promptOps }),
        )

      const results = yield* Effect.all([execute("one"), execute("two")], { concurrency: "unbounded" })
      expect(results.filter((item) => item.output.includes("Async task started"))).toHaveLength(1)
      expect(results.filter((item) => item.output.includes("Async task updated"))).toHaveLength(1)
      yield* Deferred.await(firstReady)
      yield* Deferred.succeed(firstRelease, undefined)
      yield* Deferred.await(secondReady)
      yield* Deferred.succeed(secondRelease, undefined)
      const terminal = yield* jobs.wait({ id: child.id })
      expect(terminal.info?.status).toBe("completed")
      // Observer-owned: the answer is published for the observer, not stored on the terminal.
      expect(terminal.info?.output).toBeUndefined()
      expect(prompts).toBe(2)
      yield* Effect.yieldNow
      // Two runs produced two answers, and both are delivered. Previously only the last one
      // survived, so a single notification here recorded an answer being lost rather than kept.
      expect(notifications).toBe(2)
    }),
  )

  // The attached path's result and wake leases. The coordinator here is a recorder, so these prove
  // that the lease is taken, ordered, and settled by disposition — but not that a live lease blocks
  // quiescence. That belongs at the coordinator's own boundary and is established there:
  // closure-admission.test.ts proves an execution lease rejects the proof `unverified` regardless of
  // origin or state, with the scan pair pinned so the rejection cannot be attributed to an unstable
  // scan instead.

  it.instance("takes the continuation lease before the injection and retires it after delivery", () =>
    Effect.gen(function* () {
      const jobs = yield* BackgroundJob.Service
      const coordinator = yield* AttachmentCoordinator.make
      const { chat, assistant } = yield* seed()
      const parent = yield* coordinator.open(chat.id)
      const tool = yield* TaskTool
      const def = yield* tool.init()
      const injected = yield* Deferred.make<SessionPrompt.TaskPromptInput>()
      const log = continuationLog()
      const promptOps = continuationOps(
        recordingContinuationClosure(log),
        basicOps({
          attachments: coordinator,
          prompt: (input) => {
            if (input.sessionID !== chat.id) return Effect.succeed(reply(input, "child done"))
            log.events.push("prompt")
            return Deferred.succeed(injected, input).pipe(Effect.andThen(admit(input, "parent final")))
          },
        }),
      )

      // Positive precondition on every "exactly one" below: nothing acquired and nothing settled
      // before execution, so the counts cannot be satisfied by a lease that was already present.
      expect(log.acquired).toHaveLength(0)
      expect(log.settled).toHaveLength(0)

      const started = yield* def.execute(
        { description: "attached lease", prompt: "run", subagent_type: "general", async: true },
        context({ sessionID: chat.id, messageID: assistant.id, promptOps, attachment: parent }),
      )
      const waited = yield* jobs.wait({ id: started.metadata.sessionId, timeout: 1_000 })
      expect(waited.timedOut).toBe(false)
      yield* Deferred.await(injected)
      yield* awaitSettled(log)

      // Exactly one continuation lease, carrying caller/target provenance. The caller is the parent
      // the envelope is injected into; the target is the delegated Task it reports on.
      expect(log.acquired).toHaveLength(1)
      expect(log.acquired[0]?.kind).toBe("continuation")
      expect(log.acquired[0]?.session).toBe(chat.id)
      expect(log.acquired[0]?.caller).toBe(chat.id)
      expect(log.acquired[0]?.target).toBe(started.metadata.sessionId)

      // Ordering: the lease exists before the injection it governs, which is the whole point of
      // acquiring in the calling fiber rather than inside the fork.
      expect(log.events.indexOf("acquire")).toBeGreaterThanOrEqual(0)
      expect(log.events.indexOf("prompt")).toBeGreaterThan(log.events.indexOf("acquire"))

      // Settled exactly once, on the SAME lease, from the observer's actual exit.
      expect(log.settled).toHaveLength(1)
      expect(log.settled[0]?.lease).toBe("lease_attached_1")
      expect(log.settled[0]?.disposition).toBe("retired")
      yield* parent.close()
    }),
  )

  it.instance("a refused injection makes one attempt and never retries", () =>
    Effect.gen(function* () {
      const jobs = yield* BackgroundJob.Service
      const coordinator = yield* AttachmentCoordinator.make
      const { chat, assistant } = yield* seed()
      const parent = yield* coordinator.open(chat.id)
      const tool = yield* TaskTool
      const def = yield* tool.init()
      const attempted = yield* Deferred.make<boolean>()
      const log = continuationLog()
      const promptOps = continuationOps(
        recordingContinuationClosure(log),
        basicOps({
          attachments: coordinator,
          prompt: (input) => {
            if (input.sessionID !== chat.id) return Effect.succeed(reply(input, "child done"))
            return Deferred.succeed(attempted, true).pipe(
              Effect.andThen(
                Effect.fail(new SessionClosure.AdmissionRefused({ session: input.sessionID, reason: "closing" })),
              ),
            )
          },
        }),
      )

      const started = yield* def.execute(
        { description: "attached refusal", prompt: "run", subagent_type: "general", async: true },
        context({ sessionID: chat.id, messageID: assistant.id, promptOps, attachment: parent }),
      )
      const waited = yield* jobs.wait({ id: started.metadata.sessionId, timeout: 1_000 })
      expect(waited.timedOut).toBe(false)
      // Positive precondition: the injection genuinely ran, so a non-retired settlement reflects an
      // OBSERVED refusal rather than an observer that never reached the injection at all.
      expect(yield* Deferred.await(attempted)).toBe(true)
      yield* awaitSettled(log)

      expect(log.acquired).toHaveLength(1)
      expect(log.settled).toEqual([{ lease: "lease_attached_1", disposition: "suppressed" }])
      expect(parent.current().failed).toBe(true)
      yield* parent.close()
    }),
  )

  it.instance("a cancelled root makes one refused injection attempt and never persists or retries it", () =>
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const jobs = yield* BackgroundJob.Service
      const runState = yield* SessionRunState.Service
      const coordinator = yield* AttachmentCoordinator.make
      const { chat, assistant } = yield* seed()
      const tool = yield* TaskTool
      const def = yield* tool.init()
      const childReady = yield* Deferred.make<void>()
      const attempted = yield* Deferred.make<void>()
      const observerSettled = yield* Deferred.make<void>()
      const log = continuationLog()
      const attempts: string[] = []
      const beforeMessages = (yield* sessions.messages({ sessionID: chat.id })).length
      const baseClosure = recordingContinuationClosure(log)
      const closure: SessionClosure.Interface = {
        ...baseClosure,
        retire: (lease, disposition) =>
          baseClosure.retire(lease, disposition).pipe(Effect.ensuring(Deferred.succeed(observerSettled, undefined))),
      }
      const promptOps = continuationOps(
        closure,
        basicOps({
          attachments: coordinator,
          prompt: (input) => {
            if (input.sessionID !== chat.id) {
              return Deferred.succeed(childReady, undefined).pipe(Effect.andThen(Effect.never))
            }
            const text = input.parts.findLast((part) => part.type === "text")?.text ?? ""
            attempts.push(text)
            return Deferred.succeed(attempted, undefined).pipe(
              Effect.andThen(
                Effect.fail(new SessionClosure.AdmissionRefused({ session: input.sessionID, reason: "closing" })),
              ),
            )
          },
        }),
      )

      const started = yield* def.execute(
        { description: "cancelled injection refusal", prompt: "run", subagent_type: "general", async: true },
        context({ sessionID: chat.id, messageID: assistant.id, promptOps }),
      )
      const child = SessionID.make(started.metadata.sessionId)
      yield* awaitWithTimeout(Deferred.await(childReady), "cancelled injection fixture never reached its child hold")
      yield* runState.cancel(child)
      const terminal = yield* jobs.wait({ id: child, timeout: 5_000 })
      expect(terminal.timedOut).toBe(false)
      expect(terminal.info?.status).toBe("cancelled")
      yield* awaitWithTimeout(Deferred.await(attempted), "cancelled envelope injection was never attempted")
      yield* awaitWithTimeout(Deferred.await(observerSettled), "cancelled injection refusal never settled")

      expect(attempts).toHaveLength(1)
      expect(attempts[0]).toContain('state="cancelled"')
      expect(attempts[0]).toContain("status: unknown")
      expect(attempts[0]).toContain(`task_evidence=${JSON.stringify({ task_id: child, status: "unknown" })}`)
      expect(log.acquired).toHaveLength(1)
      expect(log.settled).toEqual([{ lease: "lease_attached_1", disposition: "suppressed" }])
      expect((yield* sessions.messages({ sessionID: chat.id })).length).toBe(beforeMessages)
    }),
  )

  it.instance("an attached observer defect degrades once and never retries", () =>
    Effect.gen(function* () {
      const jobs = yield* BackgroundJob.Service
      const coordinator = yield* AttachmentCoordinator.make
      const { chat, assistant } = yield* seed()
      const parent = yield* coordinator.open(chat.id)
      const tool = yield* TaskTool
      const def = yield* tool.init()
      const reached = yield* Deferred.make<boolean>()
      const log = continuationLog()
      const promptOps = continuationOps(
        recordingContinuationClosure(log),
        basicOps({
          attachments: coordinator,
          prompt: (input) => {
            if (input.sessionID !== chat.id) return Effect.succeed(reply(input, "child done"))
            return Deferred.succeed(reached, true).pipe(Effect.andThen(Effect.die("attached observer defect")))
          },
        }),
      )

      const started = yield* def.execute(
        { description: "attached defect", prompt: "run", subagent_type: "general", async: true },
        context({ sessionID: chat.id, messageID: assistant.id, promptOps, attachment: parent }),
      )
      const waited = yield* jobs.wait({ id: started.metadata.sessionId, timeout: 1_000 })
      expect(waited.timedOut).toBe(false)
      // Positive precondition: the observer reached the injection, so `failed` reports a death that
      // happened rather than one inferred from absence.
      expect(yield* Deferred.await(reached)).toBe(true)
      yield* awaitSettled(log)

      expect(log.acquired).toHaveLength(1)
      expect(log.settled).toEqual([{ lease: "lease_attached_1", disposition: "failed" }])
      expect(parent.current().failed).toBe(true)
      yield* parent.close()
    }),
  )

  it.instance("an attached continuation-acquisition defect degrades without scheduling a fallback", () =>
    Effect.gen(function* () {
      const jobs = yield* BackgroundJob.Service
      const coordinator = yield* AttachmentCoordinator.make
      const { chat, assistant } = yield* seed()
      const parent = yield* coordinator.open(chat.id)
      const tool = yield* TaskTool
      const def = yield* tool.init()
      const acquisitions: string[] = []
      const parentPrompts: SessionPrompt.TaskPromptInput[] = []
      const base = basicOps({
        attachments: coordinator,
        prompt: (input) => {
          if (input.sessionID !== chat.id) return Effect.succeed(reply(input, "child done"))
          parentPrompts.push(input)
          return Effect.succeed(reply(input, "must not run"))
        },
      })
      const promptOps: TaskPromptOps = {
        ...base,
        acquireContinuation: (input) =>
          Effect.sync(() => acquisitions.push(input.source)).pipe(
            Effect.andThen(Effect.die("continuation acquisition defect")),
          ),
      }

      const started = yield* def.execute(
        { description: "attached acquisition defect", prompt: "run", subagent_type: "general", async: true },
        context({ sessionID: chat.id, messageID: assistant.id, promptOps, attachment: parent }),
      )
      expect((yield* jobs.wait({ id: started.metadata.sessionId, timeout: 1_000 })).timedOut).toBe(false)
      for (let attempt = 0; attempt < 1000 && acquisitions.length < 1; attempt++) yield* Effect.yieldNow

      const result = yield* parent.result(
        reply({ sessionID: chat.id, parts: [] }, "best evidence after acquisition defect"),
      )
      expect(result).toMatchObject({ type: "evidence", degraded: true })
      expect(selectedText(result)).toBe("best evidence after acquisition defect")
      expect(parent.current()).toMatchObject({ failed: true, cancelled: false })
      expect(acquisitions).toEqual(["TaskTool.notifyBackgroundResult"])
      expect(parentPrompts).toHaveLength(0)
      for (let attempt = 0; attempt < 100; attempt++) yield* Effect.yieldNow
      expect(acquisitions).toHaveLength(1)
      yield* parent.close()
    }),
  )

  it.instance("a refused acquisition runs no continuation and does not degrade", () =>
    Effect.gen(function* () {
      const jobs = yield* BackgroundJob.Service
      const coordinator = yield* AttachmentCoordinator.make
      const { chat, assistant } = yield* seed()
      const parent = yield* coordinator.open(chat.id)
      const tool = yield* TaskTool
      const def = yield* tool.init()
      const log = continuationLog()
      let parentPrompts = 0
      const promptOps = continuationOps(
        fencingContinuationClosure(log),
        basicOps({
          attachments: coordinator,
          prompt: (input) => {
            if (input.sessionID !== chat.id) return Effect.succeed(reply(input, "child done"))
            parentPrompts += 1
            return admit(input, "parent final")
          },
        }),
      )

      const started = yield* def.execute(
        { description: "attached acquisition refusal", prompt: "run", subagent_type: "general", async: true },
        context({ sessionID: chat.id, messageID: assistant.id, promptOps, attachment: parent }),
      )
      const waited = yield* jobs.wait({ id: started.metadata.sessionId, timeout: 1_000 })
      expect(waited.timedOut).toBe(false)
      yield* Effect.yieldNow
      yield* Effect.yieldNow

      // Positive precondition: the acquisition was genuinely ATTEMPTED, so "nothing settled" below
      // reports a refusal rather than a call that never happened.
      expect(log.acquired).toHaveLength(1)

      // An acquisition refusal creates no lease, so there is nothing to settle — distinct from an
      // injection refusal, which settles an existing lease `suppressed` (the test above).
      expect(log.settled).toHaveLength(0)

      // The continuation correctly does not run.
      expect(parentPrompts).toBe(0)

      // A fenced caller means the ancestor closure includes the parent, so this is an orderly
      // suppression rather than a degradation. Treating it as a failure would turn a routine
      // cancellation into an acceptance-blocking one.
      expect(parent.current().failed).toBe(false)
    }),
  )

  it.instance("a cancelled root records one acquisition refusal with no callback, persistence, or retry", () =>
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const jobs = yield* BackgroundJob.Service
      const runState = yield* SessionRunState.Service
      const coordinator = yield* AttachmentCoordinator.make
      const { chat, assistant } = yield* seed()
      const tool = yield* TaskTool
      const def = yield* tool.init()
      const childReady = yield* Deferred.make<void>()
      const refused = yield* Deferred.make<void>()
      const log = continuationLog()
      const parentPrompts: SessionPrompt.TaskPromptInput[] = []
      const beforeMessages = (yield* sessions.messages({ sessionID: chat.id })).length
      const fenced = fencingContinuationClosure(log)
      const closure: SessionClosure.Interface = {
        ...fenced,
        acquire: (input) => fenced.acquire(input).pipe(Effect.tap(() => Deferred.succeed(refused, undefined))),
      }
      const promptOps = continuationOps(
        closure,
        basicOps({
          attachments: coordinator,
          prompt: (input) => {
            if (input.sessionID !== chat.id) {
              return Deferred.succeed(childReady, undefined).pipe(Effect.andThen(Effect.never))
            }
            parentPrompts.push(input)
            return Effect.succeed(reply(input, "must not persist"))
          },
        }),
      )

      const started = yield* def.execute(
        { description: "cancelled acquisition refusal", prompt: "run", subagent_type: "general", async: true },
        context({ sessionID: chat.id, messageID: assistant.id, promptOps }),
      )
      const child = SessionID.make(started.metadata.sessionId)
      yield* awaitWithTimeout(Deferred.await(refused), "cancelled continuation acquisition was not refused")
      yield* awaitWithTimeout(Deferred.await(childReady), "cancelled acquisition fixture never reached its child hold")
      yield* runState.cancel(child)
      const terminal = yield* jobs.wait({ id: child, timeout: 5_000 })
      expect(terminal.timedOut).toBe(false)
      expect(terminal.info?.status).toBe("cancelled")

      expect(log.events.filter((event) => event === "acquire-refused")).toHaveLength(1)
      expect(log.acquired).toHaveLength(1)
      expect(log.settled).toHaveLength(0)
      expect(parentPrompts).toHaveLength(0)
      expect((yield* sessions.messages({ sessionID: chat.id })).length).toBe(beforeMessages)
    }),
  )

  it.instance("an async start whose observer never installs finalizes the owner scope and stays resumable", () =>
    Effect.gen(function* () {
      const jobs = yield* BackgroundJob.Service
      const coordinator = yield* AttachmentCoordinator.make
      const { chat, assistant } = yield* seed()
      const tool = yield* TaskTool
      const def = yield* tool.init()
      const log = continuationLog()
      // Every continuation acquisition is fenced: the born-background observer REFUSES
      // before any lease exists, so no observer ever consumes this lifetime's terminal.
      // The owner scope opened before registration must be finalized by that no-observer
      // exit — otherwise the child stays registered in the coordinator and
      // every later terminal resume dies on the exclusive open.
      const promptOps = continuationOps(
        fencingContinuationClosure(log),
        basicOps({
          attachments: coordinator,
          prompt: (input) => Effect.succeed(reply(input, "child done")),
        }),
      )

      const started = yield* def.execute(
        { description: "refused observer", prompt: "run", subagent_type: "general", async: true },
        context({ sessionID: chat.id, messageID: assistant.id, promptOps }),
      )
      expect(started.metadata.background).toBe(true)
      const child = started.metadata.sessionId
      const waited = yield* jobs.wait({ id: child, timeout: 1_000 })
      expect(waited.timedOut).toBe(false)

      // Positive precondition: the acquisition was genuinely attempted and refused.
      expect(log.acquired.length).toBeGreaterThanOrEqual(1)
      expect(log.settled).toHaveLength(0)

      // The owner scope finalized on the no-observer exit: nothing remains registered for
      // the child session. (Pre-fix, locate returned the leaked scope here.)
      yield* pollWithTimeout(
        Effect.gen(function* () {
          return (yield* coordinator.locate(child)) === undefined ? true : undefined
        }),
        "the owner scope leaked past the refused observer",
      )

      // Resumability: a terminal resume must open the child scope FRESH and deliver
      // inline. (Pre-fix, the exclusive open failed: "Attachment scope already open".)
      const resumed = yield* def.execute(
        { description: "terminal resume", prompt: "resume", subagent_type: "general", task_id: child },
        context({ sessionID: chat.id, messageID: assistant.id, promptOps }),
      )
      expect(resumed.output).toContain("child done")
      expect(resumed.output).toContain('state="completed"')
      // And the resume's own sync delivery finalized its scope too.
      yield* pollWithTimeout(
        Effect.gen(function* () {
          return (yield* coordinator.locate(child)) === undefined ? true : undefined
        }),
        "the resume's owner scope leaked past its inline delivery",
      )
    }),
  )
})

/**
 * The seam between the Task tool and branch closure.
 *
 * `task.ts` writes `taskMessageId` and `taskCallId` into the background job's metadata; nothing else
 * writes them, and `startExact` in `task.ts` is the only site that could. `closure/discovery.ts`
 * reads exactly those two keys off `entry.info.metadata` to build a branch edge, and `closure/
 * driver.ts` skips any edge carrying neither before it can record a coordinate — so a Task part
 * whose coordinates are absent is never resolved, and cancelling its branch records an unknown
 * outcome instead of settling the part.
 *
 * These tests run the producer and the consumer, not the fields between them. The closure suites
 * that otherwise cover the driver set `taskMessage`/`taskCall` directly onto a discovery item, which
 * is the right way to test the driver's own logic and cannot detect the producer being absent:
 * they supply the value production is supposed to make. Removing the two lines from `task.ts` must
 * turn these red.
 */
describe("task edge coordinates for branch closure", () => {
  it.instance("an async task records the coordinates branch closure discovers it by", () =>
    Effect.gen(function* () {
      const { chat, assistant } = yield* seed()
      const tool = yield* TaskTool
      const def = yield* tool.init()
      const coordinator = yield* AttachmentCoordinator.make
      const running = yield* Deferred.make<void>()
      const release = yield* Deferred.make<void>()
      const promptOps = basicOps({
        attachments: coordinator,
        prompt: (input) => {
          if (input.sessionID === chat.id) return Effect.succeed(reply(input, "done"))
          // Hold the child open so its job is still live when discovery enumerates.
          return Deferred.succeed(running, undefined).pipe(
            Effect.andThen(Deferred.await(release)),
            Effect.as(reply(input, "child done")),
          )
        },
      })

      const callID = "call_edge_coordinates"
      const started = yield* def.execute(
        { description: "edge coordinates", prompt: "run", subagent_type: "general", async: true },
        { ...context({ sessionID: chat.id, messageID: assistant.id, promptOps }), callID },
      )
      yield* Deferred.await(running)

      // The consumer half: the shipped discovery capability, reading the job the producer started.
      const discovery = yield* SessionClosureDiscovery.Service
      const entries = yield* discovery.jobs
      const edge = entries.find((item) => item.job === started.metadata.sessionId)

      expect(edge).toBeDefined()
      expect(edge?.taskMessage).toBe(assistant.id)
      expect(edge?.taskCall).toBe(callID)
      // The condition `driver.ts` applies before it will record a coordinate for this edge. Asserted
      // as the driver states it, because this is what decides whether the Task part is resolvable at
      // all — the two assertions above would still hold if the driver's guard changed shape.
      expect(edge?.taskMessage === undefined && edge?.taskCall === undefined).toBe(false)

      yield* Deferred.succeed(release, undefined)
    }),
  )

  it.instance("a task started without a call id records the message and omits the call", () =>
    Effect.gen(function* () {
      const { chat, assistant } = yield* seed()
      const tool = yield* TaskTool
      const def = yield* tool.init()
      const coordinator = yield* AttachmentCoordinator.make
      const running = yield* Deferred.make<void>()
      const release = yield* Deferred.make<void>()
      const promptOps = basicOps({
        attachments: coordinator,
        prompt: (input) => {
          if (input.sessionID === chat.id) return Effect.succeed(reply(input, "done"))
          return Deferred.succeed(running, undefined).pipe(
            Effect.andThen(Deferred.await(release)),
            Effect.as(reply(input, "child done")),
          )
        },
      })

      // `context()` supplies no `callID`, which is the ordinary case for a Task the model did not
      // reach through a tool call.
      const started = yield* def.execute(
        { description: "no call id", prompt: "run", subagent_type: "general", async: true },
        context({ sessionID: chat.id, messageID: assistant.id, promptOps }),
      )
      yield* Deferred.await(running)

      const discovery = yield* SessionClosureDiscovery.Service
      const entries = yield* discovery.jobs
      const edge = entries.find((item) => item.job === started.metadata.sessionId)

      expect(edge).toBeDefined()
      expect(edge?.taskMessage).toBe(assistant.id)
      // Omitted rather than written `undefined`: discovery's shape check reports "no coordinate"
      // instead of coercing one, so a missing call cannot widen what cancellation may claim.
      expect(edge?.taskCall).toBeUndefined()
      // One coordinate is still enough to pass the driver's guard, so the part stays resolvable.
      expect(edge?.taskMessage === undefined && edge?.taskCall === undefined).toBe(false)

      yield* Deferred.succeed(release, undefined)
    }),
  )

  // CP-032 R-08 made two attachment generations coexist for one session: a resolved predecessor an
  // in-flight delegated call still carries, and the live successor that atomically replaced it in the
  // registry. The mismatch branch degraded whatever the REGISTRY held, so a stale call punished the
  // innocent successor. These two rows bound the blast radius of that branch without relaxing it --
  // the delegated call still fails closed in both, only the degraded generation differs.
  it.instance("a stale carried generation fails its own call without degrading the live successor", () =>
    Effect.gen(function* () {
      const coordinator = yield* AttachmentCoordinator.make
      const { chat, assistant } = yield* seed()
      const tool = yield* TaskTool
      const def = yield* tool.init()
      const answer = (text: string) => reply({ sessionID: chat.id } as SessionPrompt.PromptInput, text)

      // Generation N, resolved through the never-attached immediate arm: registered and replaceable
      // (R-08), not closed.
      const predecessor = yield* coordinator.open(chat.id)
      yield* predecessor.result(answer("predecessor answer"))

      // Generation N+1 atomically replaces it. That this `open` SUCCEEDS is the outcome-based proof
      // that the predecessor resolved: replacement admits only a resolved incumbent, and a live one
      // still loses the exclusive open (CP-032 R-08). No Task-facing resolution sample is used.
      const successor = yield* coordinator.open(chat.id)
      expect(yield* coordinator.locate(chat.id)).toBe(successor)

      let childPrompts = 0
      const promptOps = basicOps({
        attachments: coordinator,
        prompt: (input) =>
          Effect.sync(() => {
            childPrompts += 1
            return reply(input, "must not run")
          }),
      })

      const exit = yield* Effect.exit(
        def.execute(
          { description: "stale", prompt: "run", subagent_type: "general" },
          context({ sessionID: chat.id, messageID: assistant.id, promptOps, attachment: predecessor }),
        ),
      )

      expect(Exit.isFailure(exit)).toBe(true)
      // Refused before any provider work, so failing closed costs nothing downstream.
      expect(childPrompts).toBe(0)
      // The successor took no part in this call. Pre-fix, it was the scope that got degraded.
      expect(successor.current().failed).toBe(false)
      expect(successor.current().cancelled).toBe(false)
      expect(yield* coordinator.locate(chat.id)).toBe(successor)
      // Still able to speak for its own turn.
      expect(selectedText(yield* successor.result(answer("successor answer")))).toBe("successor answer")
    }),
  )

  it.instance("a mismatch with no carried generation still degrades the registered scope", () =>
    Effect.gen(function* () {
      const coordinator = yield* AttachmentCoordinator.make
      const { chat, assistant } = yield* seed()
      const tool = yield* TaskTool
      const def = yield* tool.init()
      const scope = yield* coordinator.open(chat.id)

      let childPrompts = 0
      const promptOps = basicOps({
        attachments: coordinator,
        prompt: (input) =>
          Effect.sync(() => {
            childPrompts += 1
            return reply(input, "must not run")
          }),
      })

      // No carried scope, but the registry holds one: there is no faulting generation to name, so the
      // registry occupant remains the only thing to degrade. This is the original fail-closed
      // behaviour and the row that keeps the fix from becoming a relaxation.
      const exit = yield* Effect.exit(
        def.execute(
          { description: "uncarried", prompt: "run", subagent_type: "general" },
          context({ sessionID: chat.id, messageID: assistant.id, promptOps }),
        ),
      )

      expect(Exit.isFailure(exit)).toBe(true)
      expect(childPrompts).toBe(0)
      expect(scope.current().failed).toBe(true)
    }),
  )
})
