import { afterEach, beforeEach, describe, expect } from "bun:test"
import { Cause, Deferred, Effect, Layer } from "effect"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { BackgroundJob as CoreBackgroundJob } from "@opencode-ai/core/background-job"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Database } from "@opencode-ai/core/database/database"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { Ripgrep } from "@opencode-ai/core/ripgrep"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { Agent } from "@/agent/agent"
import { BackgroundJob } from "@/background/job"
import { BackgroundJobBinder } from "@/background/binder"
import { InstanceState } from "@/effect/instance-state"
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
import { admittingClosure, unusedJobs } from "../lib/closure"
import { recordingPhysical } from "../lib/physical"
import { awaitWithTimeout, testEffect } from "../lib/effect"
import { SessionAdmission } from "@/session/closure/admission"
import { SessionClosure } from "@/session/closure/coordinator"
import { SessionClosureDiscovery } from "@/session/closure/discovery"
import { SessionClosureModel as Model } from "@/session/closure/model"
import { SessionPhysical } from "@/session/physical-interrupt"

/**
 * CP-032 T-032-6 — TASK WIRING FOR THE SEQUENCE FLOOR (B1–B5).
 *
 * WHAT THIS FILE IS FOR, AND WHAT IT IS NOT. The floor's ORDERING PROPERTY is proved
 * deterministically in `packages/core/test/background-job.test.ts` (A1–A9) against the real
 * registry, because two TaskTool runs of one child session share a single attachment-scope one-shot
 * Deferred — "a later sequence is ready while an earlier one is still announced" cannot be
 * scheduled through this surface without a forbidden hook. That is evidence calibration, not scope
 * reduction (CP §9.5).
 *
 * What only THIS layer can establish is the WIRING: that Task announces where it claims to, that
 * the filed key comes from the CONTROLLING selected assistant rather than the run-final one, that
 * the owner's early-error exits announce nothing while the supplemental path deliberately keeps no
 * such checks, and that none of the observer's floor behaviour leaks into foreground disposition.
 *
 * NOT DUPLICATED HERE: P1/P2 (real-Runner Admission Freshness), T-032-1 (nested yield withheld —
 * `task-attachment-scope-lifetime.test.ts:504-655` owns the nested observer negative), A-1 parity
 * (`task-attachment-selected-evidence.test.ts`), and the pure foreground cells in the core suite.
 * Those are cited preservation inputs, not rows re-run here.
 *
 * THE TWO-ANSWER SHAPE. Several rows need one lifetime to carry two DISTINCT answers. That is not
 * contrived: it is CP §3.3.2's admitted-R2 case. A supplement borrows the owner's live UNRESOLVED
 * scope, but its prompt is held so it calls `Scope.result()` only AFTER the owner's resolution has
 * published. Its run-final was never covered, so Admission Freshness hands it back fresh
 * non-degraded evidence — a second, genuinely distinct answer on the same lifetime.
 */

// ---------------------------------------------------------------------------------------------
// Announce instrumentation
// ---------------------------------------------------------------------------------------------

type AnnounceRecord = { readonly id: string; readonly kind: "owner" | "supplement" }

/**
 * Every `Announce` the registry hands to a run, recorded by which registry entry point forked it:
 * `startExact` is the owner sequence, `extendExact`/`extendWithHandle` are supplements.
 *
 * This is a TEST-ONLY wrapper that DELEGATES — it counts the call and then invokes the real
 * capability, so the production decision under test still happens in production code. It exists
 * because B4's oracle is the announcement itself: an owner error exit must announce ZERO times, and
 * asserting only on the returned prose would pass a mutant that announced first and failed after.
 */
const announces: AnnounceRecord[] = []

const announcesFor = (id: string, kind: AnnounceRecord["kind"]) =>
  announces.filter((record) => record.id === id && record.kind === kind).length

/**
 * Built the way the production adapter builds it — same closure-aware binder, same
 * Instance-scoped registry — rather than by decorating the service from context, because a
 * same-tag decorator keeps a residual requirement on its own tag and `LayerNode.compile` refuses
 * it as a replacement. Only the four run-carrying entry points differ from the shipped layer.
 */
const countingJobs = Layer.effect(
  CoreBackgroundJob.Service,
  Effect.gen(function* () {
    const closure = yield* SessionClosure.Service
    const binder = yield* BackgroundJobBinder.make(closure)
    const state = yield* InstanceState.make(() => CoreBackgroundJob.makeWith(binder))
    const instrument = (
      id: string,
      kind: AnnounceRecord["kind"],
      run: Effect.Effect<CoreBackgroundJob.SequenceOutcome, unknown, CoreBackgroundJob.Announce>,
    ): Effect.Effect<CoreBackgroundJob.SequenceOutcome, unknown, CoreBackgroundJob.Announce> =>
      Effect.gen(function* () {
        const real = yield* CoreBackgroundJob.Announce
        return yield* run.pipe(
          Effect.provideService(CoreBackgroundJob.Announce, () =>
            Effect.sync(() => {
              announces.push({ id, kind })
            }).pipe(Effect.andThen(real())),
          ),
        )
      })
    return CoreBackgroundJob.Service.of({
      list: () => InstanceState.useEffect(state, (jobs) => jobs.list()),
      get: (id) => InstanceState.useEffect(state, (jobs) => jobs.get(id)),
      start: (input) => InstanceState.useEffect(state, (jobs) => jobs.start(input)),
      wait: (input) => InstanceState.useEffect(state, (jobs) => jobs.wait(input)),
      waitForPromotion: (id) => InstanceState.useEffect(state, (jobs) => jobs.waitForPromotion(id)),
      promote: (id) => InstanceState.useEffect(state, (jobs) => jobs.promote(id)),
      cancel: (id) => InstanceState.useEffect(state, (jobs) => jobs.cancel(id)),
      listExact: () => InstanceState.useEffect(state, (jobs) => jobs.listExact()),
      getExact: (lifetime) => InstanceState.useEffect(state, (jobs) => jobs.getExact(lifetime)),
      waitExact: (input) => InstanceState.useEffect(state, (jobs) => jobs.waitExact(input)),
      waitHandle: (input) => InstanceState.useEffect(state, (jobs) => jobs.waitHandle(input)),
      waitForPromotionExact: (lifetime) =>
        InstanceState.useEffect(state, (jobs) => jobs.waitForPromotionExact(lifetime)),
      promoteExact: (lifetime) => InstanceState.useEffect(state, (jobs) => jobs.promoteExact(lifetime)),
      cancelExact: (lifetime) => InstanceState.useEffect(state, (jobs) => jobs.cancelExact(lifetime)),
      observe: (invocation) => InstanceState.useEffect(state, (jobs) => jobs.observe(invocation)),
      observeHandle: (handle) => InstanceState.useEffect(state, (jobs) => jobs.observeHandle(handle)),
      waitAnswer: (input) => InstanceState.useEffect(state, (jobs) => jobs.waitAnswer(input)),
      // The four run-carrying entry points: the announcement is counted and then DELEGATED to the
      // real capability, so the decision under test still happens in production code.
      startExact: (input) =>
        InstanceState.useEffect(state, (jobs) =>
          jobs.startExact({ ...input, run: instrument(input.id ?? "<anonymous>", "owner", input.run) }),
        ),
      extendExact: (input) =>
        InstanceState.useEffect(state, (jobs) =>
          jobs.extendExact({ ...input, run: instrument(input.lifetime.id, "supplement", input.run) }),
        ),
      extendWithHandle: (input) =>
        InstanceState.useEffect(state, (jobs) =>
          jobs.extendWithHandle({ ...input, run: instrument(input.id, "supplement", input.run) }),
        ),
      extend: (input) =>
        InstanceState.useEffect(state, (jobs) =>
          jobs.extend({ ...input, run: instrument(input.id, "supplement", input.run) }),
        ),
    })
  }),
  // A `LayerNode.compile` replacement has to be self-contained, so the binder's closure is
  // provided here rather than resolved from the graph. It is the SAME admitting closure the node
  // would have supplied, so the binder wiring under test is unchanged.
).pipe(Layer.provide(admittingClosure))

// ---------------------------------------------------------------------------------------------
// Instance wiring
// ---------------------------------------------------------------------------------------------

/**
 * The observer acquires a real continuation lease before it can observe. `gate` lets a row hold the
 * observer BEFORE its first `waitAnswer`, which is how both answers can be filed before either is
 * observed — the only state in which conversation order is a property of the log rather than of
 * arrival.
 */
const continuationGate: { value?: Deferred.Deferred<void> } = {}

const continuationClosure: SessionClosure.Interface = {
  ...unusedJobs,
  request: () => Effect.die("unused"),
  view: Effect.die("unused"),
  identity: Effect.die("unused"),
  acquire: () =>
    Effect.succeed({
      type: "admitted" as const,
      lease: Model.id("lease", "lease_sequence_floor"),
      epoch: 0n,
      instance: Model.id("instance", "instance_sequence_floor"),
    }),
  bind: () => Effect.void,
  retire: () => Effect.void,
  reserveMutation: () => Effect.die("unused"),
  activateMutation: () => Effect.void,
  retireMutation: () => Effect.void,
}

beforeEach(() => {
  announces.length = 0
  continuationGate.value = undefined
})

afterEach(async () => {
  await disposeAllInstances()
})

const ref = {
  providerID: ProviderV2.ID.make("test"),
  modelID: ModelV2.ID.make("test-model"),
}

const providerLayer = Layer.mock(Provider.Service)({
  getModel: () => Effect.succeed(ProviderTest.model({ providerID: ref.providerID, id: ref.modelID })),
})

const layerFor = (experimentalBackgroundSubagents: boolean) =>
  LayerNode.compile(
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
      [RuntimeFlags.node, RuntimeFlags.layer({ experimentalBackgroundSubagents })],
      [Provider.node, providerLayer],
      [SessionPhysical.node, Layer.succeed(SessionPhysical.Service, recordingPhysical())],
      [SessionClosure.node, admittingClosure],
      // The announce-counting decorator over the production registry.
      [BackgroundJob.node, countingJobs],
    ],
  )

const it = testEffect(layerFor(true))

// ---------------------------------------------------------------------------------------------
// Deterministic fixtures
// ---------------------------------------------------------------------------------------------

/** `key` fixes the message id; `at` fixes creation time — the `(at, position)` ordering key. */
type Spec = { readonly key: string; readonly at: number; readonly text: string }

const message = (key: string) => MessageID.make(`msg_floor_${key}`)
const part = (key: string) => PartID.make(`prt_floor_${key}`)

/** Typed as `Assistant` explicitly so the errored variant below selects the same union member. */
function assistantInfo(spec: Spec, sessionID: SessionID): SessionV1.Assistant {
  return {
    id: message(spec.key),
    role: "assistant",
    parentID: message("caller"),
    sessionID,
    mode: "general",
    agent: "general",
    cost: 0,
    path: { cwd: "/tmp", root: "/tmp" },
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    modelID: ref.modelID,
    providerID: ref.providerID,
    time: { created: spec.at, completed: spec.at },
    finish: "stop",
  }
}

function partsOf(spec: Spec, sessionID: SessionID) {
  const id = message(spec.key)
  return [{ id: part(spec.key), messageID: id, sessionID, type: "text" as const, text: spec.text }]
}

function assistantOf(spec: Spec, sessionID: SessionID): SessionV1.WithParts {
  return { info: assistantInfo(spec, sessionID), parts: partsOf(spec, sessionID) }
}

/**
 * The owner-precheck trigger: a child that stopped on its OWN error. `detect` fails on this BEFORE
 * reaching return eligibility, which is exactly the ordering B4 has to pin.
 */
function erroredAssistant(spec: Spec, sessionID: SessionID): SessionV1.WithParts {
  const info: SessionV1.Assistant = {
    ...assistantInfo(spec, sessionID),
    error: new SessionV1.AbortedError({ message: "child exploded" }),
  }
  return { info, parts: partsOf(spec, sessionID) }
}

/**
 * The SECOND owner-precheck trigger, and a DISTINCT source branch: the Assistant carries no
 * `info.error` at all, but its parts contain a tool call that ended in `error`.
 *
 * `detect` tests these two shapes with two separate guards and two separate `Effect.fail` exits, so
 * a row that only builds the errored-Assistant shape leaves the failed-ToolPart guard unexercised —
 * and a mutant that announces before only that guard would survive.
 */
function failedToolAssistant(spec: Spec, sessionID: SessionID): SessionV1.WithParts {
  const id = message(spec.key)
  return {
    info: assistantInfo(spec, sessionID),
    parts: [
      ...partsOf(spec, sessionID),
      {
        id: part(`${spec.key}_tool`),
        messageID: id,
        sessionID,
        type: "tool",
        callID: `call_${spec.key}`,
        tool: "bash",
        state: {
          status: "error",
          input: { cmd: "exit 1" },
          error: "tool call failed hard",
          metadata: {},
          time: { start: spec.at, end: spec.at },
        },
      },
    ],
  }
}

function parentReply(input: SessionPrompt.PromptInput): SessionV1.WithParts {
  const id = MessageID.ascending()
  return {
    info: {
      id,
      role: "assistant",
      parentID: input.messageID ?? MessageID.ascending(),
      sessionID: input.sessionID,
      mode: "build",
      agent: "build",
      cost: 0,
      path: { cwd: "/tmp", root: "/tmp" },
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      modelID: ref.modelID,
      providerID: ref.providerID,
      time: { created: Date.now(), completed: Date.now() },
      finish: "stop",
    },
    parts: [{ id: PartID.ascending(), messageID: id, sessionID: input.sessionID, type: "text", text: "ack" }],
  }
}

function injectedText(input: SessionPrompt.PromptInput) {
  const first = input.parts[0]
  return first && first.type === "text" ? first.text : ""
}

const seed = Effect.fn("SequenceFloorTest.seed")(function* () {
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

/** Fires `onAdmitted` where production fires it: after durable persistence, before the runner. */
const admitting = (ops: TaskPromptOps): TaskPromptOps => ({
  ...ops,
  prompt: (input) =>
    Effect.gen(function* () {
      if (input.onAdmitted) yield* input.onAdmitted
      return yield* ops.prompt(input)
    }),
})

function context(input: { sessionID: SessionID; messageID: MessageID; promptOps: TaskPromptOps }): Tool.Context {
  return {
    sessionID: input.sessionID,
    messageID: input.messageID,
    agent: "build",
    abort: new AbortController().signal,
    extra: { promptOps: admitting(input.promptOps), attachment: undefined },
    messages: [],
    metadata: () => Effect.void,
    ask: () => Effect.void,
  }
}

function baseOps(input: {
  attachments: AttachmentCoordinator.Interface
  prompt: TaskPromptOps["prompt"]
}): TaskPromptOps {
  return {
    /**
     * The gate holds ONLY the async observer's own lease acquisition, keyed on the source string
     * `notify` passes. Gating the closure itself was too blunt: the same closure serves the
     * supplemental registration path, so holding it there wedged `Task(task_id=...)` before the
     * observer was ever reached.
     */
    acquireContinuation: (i) =>
      Effect.gen(function* () {
        if (continuationGate.value && i.source === "TaskTool.notifyBackgroundResult") {
          yield* Deferred.await(continuationGate.value)
        }
        return yield* SessionAdmission.acquireContinuation(continuationClosure, i)
      }),
    admitScoped: (i) => SessionAdmission.admitScoped(continuationClosure, i),
    attachments: input.attachments,
    cancel: () => Effect.void,
    physical: recordingPhysical(),
    resolvePromptParts: (template) => Effect.succeed([{ type: "text" as const, text: template }]),
    prompt: input.prompt,
  }
}

/** Bounded, clock-free settle point: a regression that delivers early does so within this drain. */
const drain = (steps = 400) =>
  Effect.gen(function* () {
    for (let step = 0; step < steps; step++) yield* Effect.yieldNow
  })

/** Failure bound, not a poll: every await below is on something a regression withholds forever. */
const settles = <A, E, R>(self: Effect.Effect<A, E, R>, what: string) =>
  awaitWithTimeout(self, `${what} — nothing was withheld correctly, it was withheld forever`, "10 seconds")

// ---------------------------------------------------------------------------------------------
// The shared owner/supplement rig
// ---------------------------------------------------------------------------------------------

type Held = {
  readonly scope: AttachmentCoordinator.Scope
  readonly reservation: AttachmentCoordinator.Reservation
  readonly sessionID: SessionID
}

const DESCENDANT = SessionID.make("ses_floor_descendant")

/**
 * How the owner's resolution is produced once the descendant settles.
 *
 * `candidate` publishes a clean CONTROLLING assistant that is deliberately NOT the run-final one —
 * which is the whole point of R-03's file key. `degrade` instead falls through to the retained
 * fallback, whose assistant is OLDER than any later run-final on the same lifetime.
 */
type Release = { readonly candidate?: Spec; readonly degrade?: boolean }

const releaseInto = (held: Held, release: Release) =>
  Effect.gen(function* () {
    const marker = yield* held.scope.terminal(held.reservation)
    if (!marker) return yield* Effect.die(new Error("releasing scope produced no terminal marker"))
    yield* held.scope.settleTerminal(marker)
    if (release.candidate) {
      yield* held.scope.observeTurn({ assistant: assistantOf(release.candidate, held.sessionID), clean: true })
    }
    if (release.degrade) yield* held.scope.degrade()
    yield* held.scope.finishContinuation()
  })

describe("CP-032 T-032-6 — Task sequence-floor wiring", () => {
  /**
   * B1 — TWO ELIGIBLE RUNS, ONE SELECTED ASSISTANT, ONE FILED IDENTITY.
   *
   * Owner and supplement both park inside `Scope.result()` before the resolution publishes, so they
   * consume the SAME one-shot result and therefore the same controlling assistant. The position is
   * the sole filing guard, so the second filing is a no-op and the parent sees exactly one delivery.
   *
   * This is the row a "key the filing to the run-final assistant" regression cannot survive: the two
   * runs have DIFFERENT run-finals, so keying by run-final files two positions and delivers twice.
   */
  it.instance("files one identity and delivers once when two runs select one assistant (B1)", () =>
    Effect.gen(function* () {
      const jobs = yield* BackgroundJob.Service
      const coordinator = yield* AttachmentCoordinator.make
      const { chat, assistant } = yield* seed()
      const tool = yield* TaskTool
      const def = yield* tool.init()

      const OWNER_FINAL: Spec = { key: "b1_owner_final", at: 500, text: "OWNER-RUN-FINAL" }
      const SUPP_FINAL: Spec = { key: "b1_supp_final", at: 2_000, text: "SUPPLEMENT-RUN-FINAL" }
      const CONTROLLING: Spec = { key: "b1_controlling", at: 1_000, text: "THE-ONE-SELECTED-ANSWER" }

      const deliveries: string[] = []
      const held = yield* Deferred.make<Held>()
      const childCalls = { value: 0 }

      const promptOps = baseOps({
        attachments: coordinator,
        prompt: (prompt) =>
          Effect.gen(function* () {
            if (prompt.sessionID === chat.id) {
              deliveries.push(injectedText(prompt))
              return parentReply(prompt)
            }
            const scope = prompt.attachmentScope
            if (!scope) return yield* Effect.die(new Error("expected an attachment scope"))
            const call = childCalls.value++
            if (call === 0) {
              yield* scope.own(prompt.messageID ?? MessageID.ascending())
              const reservation = yield* scope.reserve(DESCENDANT)
              const claim = yield* scope.claimObserver(reservation)
              if (claim.type !== "owner") return yield* Effect.die(new Error(`claim was ${claim.type}`))
              yield* Deferred.succeed(held, { scope, reservation, sessionID: prompt.sessionID })
              return assistantOf(OWNER_FINAL, prompt.sessionID)
            }
            // The supplement's own run-final differs from the owner's and from the controlling one.
            return assistantOf(SUPP_FINAL, prompt.sessionID)
          }),
      })

      const started = yield* def.execute(
        { description: "floor b1", prompt: "run", subagent_type: "general", async: true },
        context({ sessionID: chat.id, messageID: assistant.id, promptOps }),
      )
      const child = started.metadata.sessionId
      const owned = yield* settles(Deferred.await(held), "the owner run never reached its attachment hold")

      // The supplement borrows the LIVE UNRESOLVED scope and parks on the same one-shot result.
      const supplement = yield* def.execute(
        { description: "floor b1 supplement", prompt: "more", subagent_type: "general", task_id: child },
        context({ sessionID: chat.id, messageID: assistant.id, promptOps }),
      )
      expect(supplement.output).toContain('state="running"')
      yield* drain()

      // Both are parked at eligibility: nothing filed, nothing delivered, both announced.
      expect(deliveries).toHaveLength(0)
      expect(announcesFor(child, "owner")).toBe(1)
      expect(announcesFor(child, "supplement")).toBe(1)

      yield* releaseInto(owned, { candidate: CONTROLLING })
      yield* settles(jobs.wait({ id: child }), "the lifetime never terminalized")
      yield* drain()

      // ONE delivery, rendered from the ONE selected assistant — not two, and not the run-finals.
      //
      // The delivery COUNT is the discriminator that matters: the two runs have DIFFERENT
      // run-finals, so a filing keyed to the run-final rather than to the controlling selected
      // assistant would take two distinct positions and deliver twice. The rendered text then says
      // WHICH assistant controlled. (A clean selection renders `<task_result>` with the answer
      // text; assistant ids appear only on evidence lines, so text is the identity oracle here.)
      expect(deliveries).toHaveLength(1)
      expect(deliveries[0]).toContain(CONTROLLING.text)
      expect(deliveries[0]).not.toContain(OWNER_FINAL.text)
      expect(deliveries[0]).not.toContain(SUPP_FINAL.text)
    }),
  )

  /**
   * B2 — DISTINCT ANSWERS TAKE DISTINCT POSITIONS IN `(at, position)` ORDER.
   *
   * The observer is held at continuation acquisition until BOTH answers have filed and the lifetime
   * has terminalized, so delivery order is a property of the LOG rather than of arrival. The row is
   * then run twice with the chronology of the two answers SWAPPED against a fixed arrival order:
   * the owner always files first, but in one arrangement its answer is the later one.
   *
   * The product must be identical in both arrangements — ascending `(at, position)` — which is what
   * "regardless of filing arrival" means here. A scheduled later-ready/earlier-announced inversion
   * is impossible on this surface (CP §9.5); this is the order-invariant shape that replaces it.
   */
  it.instance("gives distinct answers distinct positions in conversation order (B2)", () =>
    Effect.gen(function* () {
      const jobs = yield* BackgroundJob.Service

      const arrangement = (label: string, ownerAt: number, supplementAt: number) =>
        Effect.gen(function* () {
          const coordinator = yield* AttachmentCoordinator.make
          const { chat, assistant } = yield* seed()
          const tool = yield* TaskTool
          const def = yield* tool.init()

          const OWNER_FINAL: Spec = { key: `${label}_owner_final`, at: 100, text: "OWNER-RUN-FINAL" }
          const CONTROLLING: Spec = { key: `${label}_controlling`, at: ownerAt, text: `OWNER-ANSWER-${label}` }
          const SUPP_FINAL: Spec = { key: `${label}_supp_final`, at: supplementAt, text: `SUPP-ANSWER-${label}` }

          const gate = yield* Deferred.make<void>()
          continuationGate.value = gate
          const supplementGate = yield* Deferred.make<void>()
          const deliveries: string[] = []
          const held = yield* Deferred.make<Held>()
          const supplementBorrowed = yield* Deferred.make<void>()
          // A latch rather than a poll: the second delivery completes it from inside the ingress.
          const bothDelivered = yield* Deferred.make<void>()
          const childCalls = { value: 0 }

          const promptOps = baseOps({
            attachments: coordinator,
            prompt: (prompt) =>
              Effect.gen(function* () {
                if (prompt.sessionID === chat.id) {
                  deliveries.push(injectedText(prompt))
                  if (deliveries.length >= 2) yield* Deferred.succeed(bothDelivered, undefined)
                  return parentReply(prompt)
                }
                const scope = prompt.attachmentScope
                if (!scope) return yield* Effect.die(new Error("expected an attachment scope"))
                const call = childCalls.value++
                if (call === 0) {
                  yield* scope.own(prompt.messageID ?? MessageID.ascending())
                  const reservation = yield* scope.reserve(DESCENDANT)
                  const claim = yield* scope.claimObserver(reservation)
                  if (claim.type !== "owner") return yield* Effect.die(new Error(`claim was ${claim.type}`))
                  yield* Deferred.succeed(held, { scope, reservation, sessionID: prompt.sessionID })
                  return assistantOf(OWNER_FINAL, prompt.sessionID)
                }
                // Borrowed while UNRESOLVED, but held here so `Scope.result()` runs only after the
                // owner's resolution publishes — CP §3.3.2's uncovered/fresh admitted-R2 case.
                yield* Deferred.succeed(supplementBorrowed, undefined)
                yield* Deferred.await(supplementGate)
                return assistantOf(SUPP_FINAL, prompt.sessionID)
              }),
          })

          const started = yield* def.execute(
            { description: `floor ${label}`, prompt: "run", subagent_type: "general", async: true },
            context({ sessionID: chat.id, messageID: assistant.id, promptOps }),
          )
          const child = started.metadata.sessionId
          const owned = yield* settles(Deferred.await(held), `${label}: owner never reached its hold`)

          yield* def.execute(
            { description: `floor ${label} supplement`, prompt: "more", subagent_type: "general", task_id: child },
            context({ sessionID: chat.id, messageID: assistant.id, promptOps }),
          )
          yield* settles(Deferred.await(supplementBorrowed), `${label}: supplement never borrowed the scope`)

          // The owner files FIRST in both arrangements.
          yield* releaseInto(owned, { candidate: CONTROLLING })
          yield* drain()
          yield* Deferred.succeed(supplementGate, undefined)
          yield* settles(jobs.wait({ id: child }), `${label}: the lifetime never terminalized`)

          // Nothing was delivered while the observer was held, so what follows is log order.
          expect(deliveries).toHaveLength(0)
          yield* Deferred.succeed(gate, undefined)
          yield* settles(Deferred.await(bothDelivered), `${label}: the observer never drained both answers`)
          yield* drain()
          return { deliveries, controlling: CONTROLLING, supplement: SUPP_FINAL }
        })

      // Arrangement A: arrival order and chronology DISAGREE — the owner files first but is later.
      const a = yield* arrangement("b2a", 3_000, 1_000)
      // Arrangement B: they agree.
      const b = yield* arrangement("b2b", 1_000, 3_000)

      // Two distinct positions in both, and never a duplicate.
      expect(a.deliveries).toHaveLength(2)
      expect(b.deliveries).toHaveLength(2)

      // THE ORDER-INVARIANT PRODUCT: ascending `(at, position)` in both, though arrival was fixed.
      expect(a.deliveries[0]).toContain(a.supplement.text)
      expect(a.deliveries[1]).toContain(a.controlling.text)
      expect(b.deliveries[0]).toContain(b.controlling.text)
      expect(b.deliveries[1]).toContain(b.supplement.text)
    }),
  )

  /**
   * B3 — A DEGRADED RESOLUTION KEYS THE FILING TO THE OLDER CONTROLLING ASSISTANT.
   *
   * Degradation falls through to the RETAINED FALLBACK, which is the owner's run-final — older than
   * the supplement's run-final that is live on the same lifetime. Both runs therefore resolve to an
   * assistant that is not the current run-final, and the filing must follow that older controlling
   * identity. Keying by run-final would produce a second position and a second delivery.
   *
   * This is also why the core floor is sequence-keyed rather than chronology-keyed: the announced
   * sequence has no filed key to compare against, and the key it eventually files is older than the
   * one it was detected from.
   */
  it.instance("keys a degraded filing to the older controlling assistant, not the run-final (B3)", () =>
    Effect.gen(function* () {
      const jobs = yield* BackgroundJob.Service
      const coordinator = yield* AttachmentCoordinator.make
      const { chat, assistant } = yield* seed()
      const tool = yield* TaskTool
      const def = yield* tool.init()

      const OWNER_FINAL: Spec = { key: "b3_owner_final", at: 500, text: "OLDER-RETAINED-FALLBACK" }
      const SUPP_FINAL: Spec = { key: "b3_supp_final", at: 3_000, text: "NEWER-RUN-FINAL" }

      const deliveries: string[] = []
      const held = yield* Deferred.make<Held>()
      const childCalls = { value: 0 }

      const promptOps = baseOps({
        attachments: coordinator,
        prompt: (prompt) =>
          Effect.gen(function* () {
            if (prompt.sessionID === chat.id) {
              deliveries.push(injectedText(prompt))
              return parentReply(prompt)
            }
            const scope = prompt.attachmentScope
            if (!scope) return yield* Effect.die(new Error("expected an attachment scope"))
            const call = childCalls.value++
            if (call === 0) {
              yield* scope.own(prompt.messageID ?? MessageID.ascending())
              const reservation = yield* scope.reserve(DESCENDANT)
              const claim = yield* scope.claimObserver(reservation)
              if (claim.type !== "owner") return yield* Effect.die(new Error(`claim was ${claim.type}`))
              yield* Deferred.succeed(held, { scope, reservation, sessionID: prompt.sessionID })
              return assistantOf(OWNER_FINAL, prompt.sessionID)
            }
            return assistantOf(SUPP_FINAL, prompt.sessionID)
          }),
      })

      const started = yield* def.execute(
        { description: "floor b3", prompt: "run", subagent_type: "general", async: true },
        context({ sessionID: chat.id, messageID: assistant.id, promptOps }),
      )
      const child = started.metadata.sessionId
      const owned = yield* settles(Deferred.await(held), "the owner run never reached its attachment hold")

      yield* def.execute(
        { description: "floor b3 supplement", prompt: "more", subagent_type: "general", task_id: child },
        context({ sessionID: chat.id, messageID: assistant.id, promptOps }),
      )
      yield* drain()

      yield* releaseInto(owned, { degrade: true })
      yield* settles(jobs.wait({ id: child }), "the lifetime never terminalized")
      yield* drain()

      // One delivery, keyed and rendered to the OLDER controlling assistant, carrying the degraded
      // warning — and carrying nothing from the newer run-final that was live at the same time.
      //
      // Both runs resolved to an assistant that is NOT their run-final, and the newer run-final was
      // live on this lifetime the whole time. Keying the filing to the run-final would therefore
      // produce a second position and a second delivery; the count is what forbids that.
      expect(deliveries).toHaveLength(1)
      expect(deliveries[0]).toContain(OWNER_FINAL.text)
      expect(deliveries[0]).not.toContain(SUPP_FINAL.text)
      expect(deliveries[0]).toContain("<task_warning>")
    }),
  )

  /**
   * B4 — BOTH OWNER PRECHECKS ANNOUNCE NOTHING; THE SUPPLEMENT DELIBERATELY HAS NEITHER.
   *
   * `detect` runs TWO distinct guards before eligibility — the Assistant's own `info.error`, and a
   * failed ToolPart among its parts — each with its own `Effect.fail` exit. They are separate source
   * branches, so a row that drives only the first leaves the second unproven and a mutant that
   * announced ahead of only that guard would survive. Both are therefore driven independently here.
   *
   * `executeSupplement` has NEITHER guard and reaches the same gate directly. CP §3.3 calls that
   * asymmetry preserved, not copied — so both halves need an oracle, and the oracle is the
   * ANNOUNCEMENT, not the returned prose: a regression that announced first and failed afterwards
   * returns identical text.
   *
   * Owner arms assert an exact DELTA rather than an absolute count, so announcements made by the
   * valid-answer control can never mask a regression regardless of arm order.
   */
  it.instance("announces nothing on either owner precheck exit, and still announces for supplements (B4)", () =>
    Effect.gen(function* () {
      const jobs = yield* BackgroundJob.Service
      const coordinator = yield* AttachmentCoordinator.make
      const { chat, assistant } = yield* seed()
      const tool = yield* TaskTool
      const def = yield* tool.init()

      const ERRORED: Spec = { key: "b4_errored", at: 400, text: "ERRORED-TURN" }
      const TOOLFAIL: Spec = { key: "b4_toolfail", at: 500, text: "TOOL-FAILED-TURN" }
      const VALID: Spec = { key: "b4_valid", at: 900, text: "VALID-ANSWER" }
      const SUPP_FINAL: Spec = { key: "b4_supp_final", at: 1_500, text: "SUPPLEMENT-TURN" }
      const CONTROLLING: Spec = { key: "b4_controlling", at: 1_200, text: "SELECTED-ANSWER" }

      const ownerAnnounces = () => announces.filter((record) => record.kind === "owner").length

      // --- ARM 1: each owner precheck, driven independently -------------------------------------
      const ownerExit = (label: string, reason: string, shape: (sessionID: SessionID) => SessionV1.WithParts) =>
        Effect.gen(function* () {
          const before = ownerAnnounces()
          const exit = yield* def
            .execute(
              { description: `floor b4 ${label}`, prompt: "run", subagent_type: "general" },
              context({
                sessionID: chat.id,
                messageID: assistant.id,
                promptOps: baseOps({
                  attachments: coordinator,
                  prompt: (prompt) =>
                    prompt.sessionID === chat.id
                      ? Effect.succeed(parentReply(prompt))
                      : Effect.succeed(shape(prompt.sessionID)),
                }),
              }),
            )
            .pipe(Effect.exit)
          expect(exit._tag).toBe("Failure")
          // Prove this arm took ITS OWN guard rather than failing for some unrelated reason. The two
          // guards surface distinct text, so matching one discriminates the branch — without this a
          // fixture that failed for any other cause would satisfy the assertion above.
          if (exit._tag === "Failure") {
            const squashed = Cause.squash(exit.cause)
            expect(squashed instanceof Error ? squashed.message : String(squashed)).toContain(reason)
          }
          // The exit happened BEFORE eligibility, so this call announced nothing at all. A zero
          // DELTA holds no matter what any other arm has already announced.
          expect(ownerAnnounces() - before).toBe(0)
        })

      yield* ownerExit("assistant error", "child exploded", (sessionID) => erroredAssistant(ERRORED, sessionID))
      yield* ownerExit("failed tool part", "tool call failed hard", (sessionID) =>
        failedToolAssistant(TOOLFAIL, sessionID),
      )

      // --- ARM 2: a later valid owner answer is unaffected (the vacuity control) ----------------
      const deliveries: string[] = []
      const beforeValid = ownerAnnounces()
      const valid = yield* def.execute(
        { description: "floor b4 valid", prompt: "run", subagent_type: "general" },
        context({
          sessionID: chat.id,
          messageID: assistant.id,
          promptOps: baseOps({
            attachments: coordinator,
            prompt: (prompt) =>
              prompt.sessionID === chat.id
                ? Effect.sync(() => deliveries.push(injectedText(prompt))).pipe(Effect.as(parentReply(prompt)))
                : Effect.succeed(assistantOf(VALID, prompt.sessionID)),
          }),
        }),
      )
      expect(valid.output).toContain(VALID.text)
      // An owner that PASSES both guards announces exactly once, so the zero deltas above are facts
      // about the precheck exits rather than about announcements being unreachable in this fixture.
      expect(ownerAnnounces() - beforeValid).toBe(1)

      // --- ARM 3: BOTH shapes still reach eligibility on the supplemental path ------------------
      const held = yield* Deferred.make<Held>()
      const childCalls = { value: 0 }
      const supplementOps = baseOps({
        attachments: coordinator,
        prompt: (prompt) =>
          Effect.gen(function* () {
            if (prompt.sessionID === chat.id) return parentReply(prompt)
            const scope = prompt.attachmentScope
            if (!scope) return yield* Effect.die(new Error("expected an attachment scope"))
            const call = childCalls.value++
            if (call === 0) {
              yield* scope.own(prompt.messageID ?? MessageID.ascending())
              const reservation = yield* scope.reserve(DESCENDANT)
              const claim = yield* scope.claimObserver(reservation)
              if (claim.type !== "owner") return yield* Effect.die(new Error(`claim was ${claim.type}`))
              yield* Deferred.succeed(held, { scope, reservation, sessionID: prompt.sessionID })
              return assistantOf(SUPP_FINAL, prompt.sessionID)
            }
            // The SAME two shapes that stopped the owner above, one per supplement. The supplemental
            // path has neither guard, so both must still pass through return eligibility.
            return call === 1
              ? erroredAssistant(ERRORED, prompt.sessionID)
              : failedToolAssistant(TOOLFAIL, prompt.sessionID)
          }),
      })

      const live = yield* def.execute(
        { description: "floor b4 live", prompt: "run", subagent_type: "general", async: true },
        context({ sessionID: chat.id, messageID: assistant.id, promptOps: supplementOps }),
      )
      const child = live.metadata.sessionId
      const owned = yield* settles(Deferred.await(held), "the owner run never reached its attachment hold")

      // Both supplements borrow the SAME live UNRESOLVED scope before it publishes, so each parks at
      // eligibility and each must have announced on its way in.
      for (const label of ["assistant error", "failed tool part"]) {
        const receipt = yield* def.execute(
          { description: `floor b4 supplement ${label}`, prompt: "more", subagent_type: "general", task_id: child },
          context({ sessionID: chat.id, messageID: assistant.id, promptOps: supplementOps }),
        )
        expect(receipt.output).toContain('state="running"')
      }
      yield* drain()

      // THE ASYMMETRY, asserted as state rather than prose: BOTH supplements announced although
      // their results carry exactly the shapes that made the owner exit early.
      expect(announcesFor(child, "supplement")).toBe(2)

      yield* releaseInto(owned, { candidate: CONTROLLING })
      yield* settles(jobs.wait({ id: child }), "the lifetime never terminalized")
    }),
  )

  /**
   * B5 — FOREGROUND STAYS FOREGROUND (U-09).
   *
   * A supplemental call against a foreground owner returns ONLY its receipt; it never waits for and
   * never steals the owner's answer, and the blocked owner stays blocked while the scope is
   * unresolved. At disposition the foreground buffer is ordered by `(at, position)` and the inline
   * slot takes the EARLIEST answer — the observer's sequence floor plays no part in that choice.
   *
   * The row is built so those two rules DISAGREE: the earliest answer belongs to the LATER sequence.
   * A foreground disposition that consulted a sequence floor would return the owner's later answer.
   */
  it.instance("returns a receipt only, keeps the caller pending, and disposes by (at, position) (B5)", () =>
    Effect.gen(function* () {
      const coordinator = yield* AttachmentCoordinator.make
      const { chat, assistant } = yield* seed()
      const tool = yield* TaskTool
      const def = yield* tool.init()

      const OWNER_FINAL: Spec = { key: "b5_owner_final", at: 100, text: "OWNER-RUN-FINAL" }
      const CONTROLLING: Spec = { key: "b5_controlling", at: 3_000, text: "OWNER-LATER-ANSWER" }
      const SUPP_FINAL: Spec = { key: "b5_supp_final", at: 1_000, text: "SUPPLEMENT-EARLIER-ANSWER" }

      const supplementGate = yield* Deferred.make<void>()
      const supplementBorrowed = yield* Deferred.make<void>()
      const held = yield* Deferred.make<Held>()
      const returned = yield* Deferred.make<string>()
      const deliveries: string[] = []
      const childCalls = { value: 0 }

      const promptOps = baseOps({
        attachments: coordinator,
        prompt: (prompt) =>
          Effect.gen(function* () {
            if (prompt.sessionID === chat.id) {
              deliveries.push(injectedText(prompt))
              return parentReply(prompt)
            }
            const scope = prompt.attachmentScope
            if (!scope) return yield* Effect.die(new Error("expected an attachment scope"))
            const call = childCalls.value++
            if (call === 0) {
              yield* scope.own(prompt.messageID ?? MessageID.ascending())
              const reservation = yield* scope.reserve(DESCENDANT)
              const claim = yield* scope.claimObserver(reservation)
              if (claim.type !== "owner") return yield* Effect.die(new Error(`claim was ${claim.type}`))
              yield* Deferred.succeed(held, { scope, reservation, sessionID: prompt.sessionID })
              return assistantOf(OWNER_FINAL, prompt.sessionID)
            }
            yield* Deferred.succeed(supplementBorrowed, undefined)
            yield* Deferred.await(supplementGate)
            return assistantOf(SUPP_FINAL, prompt.sessionID)
          }),
      })

      // SYNCHRONOUS owner: no `async`, so this lifetime is foreground and has no observer at all.
      yield* def
        .execute(
          { description: "floor b5", prompt: "run", subagent_type: "general" },
          context({ sessionID: chat.id, messageID: assistant.id, promptOps }),
        )
        .pipe(
          Effect.flatMap((result) => Deferred.succeed(returned, result.output)),
          Effect.forkChild,
        )

      const owned = yield* settles(Deferred.await(held), "the owner run never reached its attachment hold")
      const child = owned.sessionID

      const supplement = yield* def.execute(
        { description: "floor b5 supplement", prompt: "more", subagent_type: "general", task_id: child },
        context({ sessionID: chat.id, messageID: assistant.id, promptOps }),
      )
      yield* settles(Deferred.await(supplementBorrowed), "the supplement never borrowed the scope")
      yield* drain()

      // U-09: the supplement got a RECEIPT, not an answer, and the owner's caller is still blocked.
      expect(supplement.output).toContain('state="running"')
      expect(supplement.output).not.toContain(OWNER_FINAL.text)
      expect(yield* Deferred.isDone(returned)).toBe(false)

      yield* releaseInto(owned, { candidate: CONTROLLING })
      yield* drain()
      // Still pending: the supplement is registered, so the lifetime cannot dispose yet.
      expect(yield* Deferred.isDone(returned)).toBe(false)

      yield* Deferred.succeed(supplementGate, undefined)
      const output = yield* settles(Deferred.await(returned), "the foreground caller never received its answer")

      // Disposition took the EARLIEST `(at, position)` answer, which belongs to the LATER sequence.
      // The two rules disagree here by construction, so a foreground disposition that consulted a
      // sequence floor would return the owner's later answer instead.
      expect(output).toContain(SUPP_FINAL.text)
      expect(output).not.toContain(CONTROLLING.text)
      // Foreground never publishes to the observer log, so nothing was injected into the parent.
      expect(deliveries).toHaveLength(0)
    }),
  )
})
