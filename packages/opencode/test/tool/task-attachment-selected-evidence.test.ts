import { afterEach, describe, expect } from "bun:test"
import { Cause, Deferred, Effect, Exit, Layer } from "effect"
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
import { admittingClosure, unusedJobs } from "../lib/closure"
import { recordingPhysical } from "../lib/physical"
import { awaitWithTimeout, testEffect } from "../lib/effect"
import { SessionAdmission } from "@/session/closure/admission"
import { SessionClosure } from "@/session/closure/coordinator"
import { SessionClosureDiscovery } from "@/session/closure/discovery"
import { SessionClosureModel as Model } from "@/session/closure/model"
import { SessionPhysical } from "@/session/physical-interrupt"
import { controllingAssistant, renderSelectedTask, type TaskSelectedReturn } from "@/session/task-return"

/**
 * CP-032 A-1 / T-032-2 — SELECTED-EVIDENCE PARITY ACROSS DELIVERY SURFACES.
 *
 * One matrix, one oracle, two surfaces. Each row builds ONE coordinator evidence shape and feeds it
 * through both unpromoted synchronous Task rendering (`task.ts`'s `Info.output` -> `renderSelectedTask`)
 * and born-async observer delivery (`renderAnswer` -> `renderSelectedTask`).
 *
 * WHY A DEDICATED FILE. The historical defect was not a wrong render, it was a wrong INPUT: the
 * observer rebuilt `{ fallback, degraded:false }` from the run-final message and discarded the
 * coordinator's resolution, so candidate/observed selection and the degraded warning were
 * unreachable on every async route while `task-return.ts` still contained both branches. Source
 * presence is therefore not evidence here; only a test that drives both surfaces from one shape and
 * compares them can close A-1. Isolated from the K14/B-3 files on purpose (CP §9.2, §10.3) so a
 * cancellation fixture can never be mistaken for parity evidence.
 *
 * THE FIXTURE IS THE INCIDENT'S OWN SHAPE. Every attached row holds a descendant, lets the owner's
 * run return its run-final, and only THEN records the child's evidence and releases — which is
 * exactly the nested-yield sequence: the run-final is retained as the fallback while parked, the
 * later turn becomes the candidate, and selection must prefer the later turn. It also makes the
 * pre-release negative free on every row: nothing may be rendered or delivered while the attachment
 * is outstanding. Recording evidence BEFORE the owner parks would not merely be less faithful, it
 * would publish the resolution early and leave the run-final uncovered — Admission Freshness would
 * then correctly hand the run back fresh evidence, testing a different thing entirely.
 *
 * WHAT THE ORACLE IS. Not substring equality. Each row asserts:
 *   1. the SLOTS of the published structural record (candidate / observed / fallback / degraded) by
 *      exact Assistant message id;
 *   2. the CONTROLLING assistant, through the shipped `controllingAssistant`, by exact id;
 *   3. per surface, exact string equality against `renderSelectedTask` of the coordinator's OWN
 *      published record — so a surface that rendered anything else fails even when its text looks
 *      plausible; and
 *   4. cross-surface equality of the two delivered strings once the child session id is normalised.
 *
 * Deterministic message ids and creation times (`assistantOf`) are what make (4) exact: the two
 * surfaces run distinct child sessions, so the session id is the ONLY legitimate difference between
 * their rendered bytes. Any other difference is a real divergence.
 *
 * SCOPE. Delivery-surface parity only. Cancellation transport and status provenance (A-3/A-4,
 * T-032-10) are deliberately absent and must not be credited from this file.
 */

// Root async delivery routes through `attach()` -> `notify`, which acquires a real continuation
// lease before it can observe. Only the closure is faked; the shipped acquire/observe/settle split
// runs, so the observer under test is the production one.
const continuationClosure: SessionClosure.Interface = {
  ...unusedJobs,
  request: () => Effect.die("unused"),
  view: Effect.die("unused"),
  identity: Effect.die("unused"),
  acquire: () =>
    Effect.succeed({
      type: "admitted" as const,
      lease: Model.id("lease", "lease_selected_evidence"),
      epoch: 0n,
      instance: Model.id("instance", "instance_selected_evidence"),
    }),
  bind: () => Effect.void,
  retire: () => Effect.void,
  reserveMutation: () => Effect.die("unused"),
  activateMutation: () => Effect.void,
  retireMutation: () => Effect.void,
}

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
      // Discovery needs a `SessionPhysical` to build and never signals through it here.
      [SessionPhysical.node, Layer.succeed(SessionPhysical.Service, recordingPhysical())],
      // The binder resolves whichever closure the layer provides; without an admitting one every job
      // is refused and every task surfaces as cancelled.
      [SessionClosure.node, admittingClosure],
    ],
  )

/** Attachment is reachable only with the flag on, so the matrix runs here. */
const it = testEffect(layerFor(true))
/** The ONLY configuration in which an owner run reaches `eligible`'s scope-less branch. */
const itScopeless = testEffect(layerFor(false))

// ---------------------------------------------------------------------------------------------
// Deterministic fixtures
// ---------------------------------------------------------------------------------------------

/**
 * One Assistant the matrix can name.
 *
 * `key` fixes the message and part id; `at` fixes `created` and `completed`. Fixed rather than
 * ascending because the cross-surface oracle compares rendered BYTES: an evidence line carries
 * `messageID`, `assistant_time` and `last_part.id`, so ascending ids would make the two surfaces
 * differ for a reason that is not a defect and force the comparison down to substrings.
 */
type Spec = { readonly key: string; readonly at: number; readonly text: string }

const message = (key: string) => MessageID.make(`msg_cp032_${key}`)
const part = (key: string) => PartID.make(`prt_cp032_${key}`)

function assistantOf(spec: Spec, sessionID: SessionID): SessionV1.WithParts {
  const id = message(spec.key)
  return {
    info: {
      id,
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
    },
    parts: [{ id: part(spec.key), messageID: id, sessionID, type: "text", text: spec.text }],
  }
}

/** The parent's own reply to an injected delivery. Never selected; only the injected text matters. */
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

const seed = Effect.fn("SelectedEvidenceTest.seed")(function* () {
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
    acquireContinuation: (i) => SessionAdmission.acquireContinuation(continuationClosure, i),
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

/**
 * Every await below is on something a regression can withhold FOREVER rather than get wrong — a
 * shortcut that never parks, an observer that never delivers. Bun's per-test timeout fails the test
 * without interrupting the fiber, so an unbounded await here would wedge the runner instead of
 * reporting. The bound is far above any honest path (whole file runs in seconds) and is a failure
 * bound, not a poll or a sleep: nothing waits ON it, and reaching it is always a defect.
 */
const settles = <A, E, R>(self: Effect.Effect<A, E, R>, what: string) =>
  awaitWithTimeout(self, `${what} — nothing was withheld correctly, it was withheld forever`, "10 seconds")

// ---------------------------------------------------------------------------------------------
// The evidence shape
// ---------------------------------------------------------------------------------------------

/**
 * ONE description of coordinator state, applied identically on both surfaces.
 *
 * `final` is the run-final Assistant the child run returns; `Scope.result` latches it as the
 * retained fallback. `observed` and `candidate` are recorded through the production `observeTurn`
 * seam AFTER the owner has parked, in that order, so the candidate always carries the higher `order`
 * and `select`'s observed-outranks-candidate branch is never silently exercised in place of the one
 * a row names.
 *
 * `immediate` drops the attachment entirely: the scope exists and was never attached, so `result()`
 * mints its resolution on the spot instead of parking. That is a different publication site from
 * `gate()`, and the one an "a scope exists, therefore defer" regression would stall at.
 *
 * `wake` is required for an observed-only CLEAN resolution: `gate()` accepts a bare `observed`
 * only within its own wake epoch, which is the message-free wake production uses when a joined run
 * ends with no clean candidate.
 */
type Shape = {
  readonly observed?: Spec
  readonly candidate?: Spec
  readonly final: Spec
  readonly degrade?: boolean
  readonly immediate?: boolean
  readonly wake?: boolean
}

const DESCENDANT = SessionID.make("ses_cp032_descendant")

type Held = {
  readonly scope: AttachmentCoordinator.Scope
  readonly reservation: AttachmentCoordinator.Reservation
  readonly sessionID: SessionID
}

/**
 * Everything the run does to its own scope before returning its turn result.
 *
 * Attached rows take a real descendant reservation and win the owner observer claim, which is what
 * `everAttached` and the outstanding continuation come from; the claim is deliberately NOT released
 * here, so `gate()` cannot resolve and eligibility parks. Immediate rows record their evidence here
 * instead, because there is nothing outstanding to wait for and no later release to record it in.
 */
const beginRun = (shape: Shape, scope: AttachmentCoordinator.Scope, sessionID: SessionID) =>
  Effect.gen(function* () {
    if (shape.immediate) {
      if (shape.observed) yield* scope.observeTurn({ assistant: assistantOf(shape.observed, sessionID), clean: false })
      if (shape.candidate) yield* scope.observeTurn({ assistant: assistantOf(shape.candidate, sessionID), clean: true })
      return undefined
    }
    const reservation = yield* scope.reserve(DESCENDANT)
    const claim = yield* scope.claimObserver(reservation)
    if (claim.type !== "owner") return yield* Effect.die(new Error(`expected owner claim, got ${claim.type}`))
    return { scope, reservation, sessionID } satisfies Held
  })

/**
 * The descendant settles, the child produces its real turn, and eligibility resolves.
 *
 * Order is load-bearing. `terminal` invalidates, so every observation belongs after it. `degrade`
 * refuses nothing but blocks later observations, so it belongs after them. `finishContinuation` is
 * last because the outstanding continuation is the only remaining blocker: it is the single step
 * that lets `gate()` publish, which is what makes the release a release rather than a drift.
 */
const releaseInto = (held: Held, shape: Shape) =>
  Effect.gen(function* () {
    const marker = yield* held.scope.terminal(held.reservation)
    if (!marker) return yield* Effect.die(new Error("releasing scope produced no terminal marker"))
    yield* held.scope.settleTerminal(marker)
    if (shape.wake) {
      const began = yield* held.scope.beginWake()
      if (!began) return yield* Effect.die(new Error("expected the released scope to need a wake"))
    }
    if (shape.observed) {
      yield* held.scope.observeTurn({ assistant: assistantOf(shape.observed, held.sessionID), clean: false })
    }
    if (shape.candidate) {
      yield* held.scope.observeTurn({ assistant: assistantOf(shape.candidate, held.sessionID), clean: true })
    }
    if (shape.wake) yield* held.scope.endWake()
    if (shape.degrade) yield* held.scope.degrade()
    yield* held.scope.finishContinuation()
  })

// ---------------------------------------------------------------------------------------------
// Surfaces
// ---------------------------------------------------------------------------------------------

type Surface = {
  readonly childID: SessionID
  readonly scope: AttachmentCoordinator.Scope
  readonly delivered: string
  readonly deliveries: readonly string[]
}

/**
 * Reads back the record the coordinator actually published.
 *
 * `result()` with a COVERED assistant id consumes the published selected structural result
 * (CP-032 §3.3.2), and the run-final was enrolled when the owner's own `result()` entered while
 * unresolved — so re-presenting it returns exactly what the surface was handed, and still does
 * after close. This is why the oracle can be the coordinator's own record rather than a restatement
 * of the selection rules inside the test.
 */
const publishedRecord = (surface: Surface, shape: Shape) =>
  surface.scope.result(assistantOf(shape.final, surface.childID))

/** Drives ONE shape through both delivery surfaces inside one instance. */
const driveBoth = (shape: Shape) =>
  Effect.gen(function* () {
    const jobs = yield* BackgroundJob.Service
    const coordinator = yield* AttachmentCoordinator.make
    const { chat, assistant } = yield* seed()
    const tool = yield* TaskTool
    const def = yield* tool.init()

    const surfaceOps = (input: {
      captured: { scope?: AttachmentCoordinator.Scope }
      held: Deferred.Deferred<Held>
      deliveries: string[]
      first?: Deferred.Deferred<void>
    }) =>
      baseOps({
        attachments: coordinator,
        prompt: (prompt) =>
          Effect.gen(function* () {
            if (prompt.sessionID === chat.id) {
              input.deliveries.push(injectedText(prompt))
              if (input.first) yield* Deferred.succeed(input.first, undefined)
              return parentReply(prompt)
            }
            const scope = prompt.attachmentScope
            if (!scope) return yield* Effect.die(new Error("expected an owner attachment scope"))
            input.captured.scope = scope
            yield* scope.own(prompt.messageID ?? MessageID.ascending())
            const held = yield* beginRun(shape, scope, prompt.sessionID)
            if (held) yield* Deferred.succeed(input.held, held)
            return assistantOf(shape.final, prompt.sessionID)
          }),
      })

    // --- unpromoted synchronous delivery ------------------------------------------------------
    const syncCaptured: { scope?: AttachmentCoordinator.Scope } = {}
    const syncHeld = yield* Deferred.make<Held>()
    const syncDeliveries: string[] = []
    const syncReturned = yield* Deferred.make<{ readonly output: string; readonly childID: SessionID }>()
    yield* def
      .execute(
        { description: "selected evidence sync", prompt: "run", subagent_type: "general" },
        context({
          sessionID: chat.id,
          messageID: assistant.id,
          promptOps: surfaceOps({ captured: syncCaptured, held: syncHeld, deliveries: syncDeliveries }),
        }),
      )
      .pipe(
        Effect.flatMap((result) =>
          Deferred.succeed(syncReturned, { output: result.output, childID: result.metadata.sessionId }),
        ),
        Effect.forkChild,
      )
    if (!shape.immediate) {
      const held = yield* settles(Deferred.await(syncHeld), "the synchronous run never reached its attachment hold")
      yield* drain()
      // THE NEGATIVE, on every attached row. The run has produced its turn result and the
      // attachment is still outstanding, so nothing may be rendered, returned or filed.
      expect(yield* Deferred.isDone(syncReturned)).toBe(false)
      expect(held.scope.current()).toMatchObject({ attached: 1, everAttached: true })
      yield* releaseInto(held, shape)
    }
    const syncResult = yield* settles(
      Deferred.await(syncReturned),
      "the synchronous Task never returned its selected answer",
    )
    // A synchronous return is rendered inline; nothing is injected into the parent.
    expect(syncDeliveries).toHaveLength(0)
    const sync: Surface = {
      childID: syncResult.childID,
      scope: syncCaptured.scope!,
      delivered: syncResult.output,
      deliveries: [syncResult.output],
    }

    // --- born-async observer delivery ---------------------------------------------------------
    const asyncCaptured: { scope?: AttachmentCoordinator.Scope } = {}
    const asyncHeld = yield* Deferred.make<Held>()
    const asyncDeliveries: string[] = []
    const firstInjection = yield* Deferred.make<void>()
    const started = yield* def.execute(
      { description: "selected evidence async", prompt: "run", subagent_type: "general", async: true },
      context({
        sessionID: chat.id,
        messageID: assistant.id,
        promptOps: surfaceOps({
          captured: asyncCaptured,
          held: asyncHeld,
          deliveries: asyncDeliveries,
          first: firstInjection,
        }),
      }),
    )
    expect(started.output).toContain(`state="running"`)
    if (!shape.immediate) {
      const held = yield* settles(Deferred.await(asyncHeld), "the born-async run never reached its attachment hold")
      yield* drain()
      // The observer half of the same negative: it is live and waiting, and the answer is withheld
      // because eligibility has not resolved rather than because nothing has happened yet.
      expect(asyncDeliveries).toHaveLength(0)
      expect((yield* jobs.get(started.metadata.sessionId))?.status).toBe("running")
      yield* releaseInto(held, shape)
    }
    yield* settles(Deferred.await(firstInjection), "the born-async observer never delivered its selected answer")
    yield* settles(
      jobs.wait({ id: started.metadata.sessionId }),
      "the born-async job never terminalized after its selected answer",
    )
    // After the terminal a second delivery would already be reachable; draining gives it the chance
    // to appear, so "exactly one" is a real count rather than a race that has not resolved yet.
    yield* drain()
    const asyncSurface: Surface = {
      childID: started.metadata.sessionId,
      scope: asyncCaptured.scope!,
      delivered: asyncDeliveries[0] ?? "",
      deliveries: asyncDeliveries,
    }

    return { sync, async: asyncSurface }
  })

// ---------------------------------------------------------------------------------------------
// The shared cross-surface oracle
// ---------------------------------------------------------------------------------------------

type Expected = {
  readonly controlling: Spec
  readonly candidate?: Spec
  readonly observed?: Spec
  readonly fallback: Spec
  readonly degraded: boolean
  /** Set when `select` must hand `classify` an `earlierObserved` second fact. */
  readonly earlierObserved?: Spec
  /** Was the scope genuinely attached? Separates `gate()` from `result()`'s immediate mint. */
  readonly everAttached: boolean
}

function evidenceRecord(record: TaskSelectedReturn) {
  if (record.type !== "evidence") throw new Error(`expected evidence, received ${record.type}`)
  return record
}

/** Asserts one surface's record slots, controlling identity, classification and exact bytes. */
const assertSurface = (surface: Surface, expected: Expected, record: TaskSelectedReturn) =>
  Effect.sync(() => {
    const evidence = evidenceRecord(record)

    // 1. SLOTS, by exact assistant identity. Not by text: two slots can carry the same text, and a
    //    regression that moved evidence between them would still read as correct.
    expect(evidence.candidate?.assistant.info.id).toBe(expected.candidate ? message(expected.candidate.key) : undefined)
    expect(evidence.observed?.assistant.info.id).toBe(expected.observed ? message(expected.observed.key) : undefined)
    expect(evidence.fallback.info.id).toBe(message(expected.fallback.key))
    expect(evidence.degraded).toBe(expected.degraded)

    // 2. CONTROLLING assistant, through the shipped precedence rather than a restatement of it.
    expect(controllingAssistant(evidence)?.info.id).toBe(message(expected.controlling.key))

    // 3. The surface rendered THAT record — exact bytes, not a plausible-looking substring.
    expect(surface.delivered).toBe(renderSelectedTask({ sessionID: surface.childID, selected: evidence }))

    // The publication site the row intends.
    expect(surface.scope.current().everAttached).toBe(expected.everAttached)

    // The degraded warning is a classification fact, so assert it in both directions.
    expect(surface.delivered.includes("<task_warning>")).toBe(expected.degraded)
    if (expected.degraded) {
      expect(surface.delivered).toContain(
        "Attachment coordination degraded. Returning the best observed output; background work was not interrupted.",
      )
    }

    // The two-fact rule: an empty or whitespace-only final selection keeps the earlier observed turn
    // as a SECOND fact rather than collapsing to it or dropping it.
    expect(surface.delivered.includes("final TextPart was absent")).toBe(expected.earlierObserved !== undefined)
    if (expected.earlierObserved) {
      expect(surface.delivered).toContain(`"messageID":"${message(expected.earlierObserved.key)}"`)
      // The notice speaks for the SELECTED assistant and the evidence line for the earlier observed
      // one. Reversing them would still contain both, so assert the order.
      expect(surface.delivered.indexOf("final TextPart was absent")).toBeLessThan(
        surface.delivered.indexOf("task_evidence="),
      )
    }
  })

/** Runs one shape through both surfaces and applies the full oracle to each. */
const expectParity = (shape: Shape, expected: Expected) =>
  Effect.gen(function* () {
    const surfaces = yield* driveBoth(shape)

    // Exactly one observer delivery. Zero is a withheld answer; two is a duplicate.
    expect(surfaces.async.deliveries).toHaveLength(1)

    const syncRecord = yield* publishedRecord(surfaces.sync, shape)
    const asyncRecord = yield* publishedRecord(surfaces.async, shape)
    yield* assertSurface(surfaces.sync, expected, syncRecord)
    yield* assertSurface(surfaces.async, expected, asyncRecord)

    // 4. Cross-surface equality. The two runs use distinct child sessions, and deterministic
    //    assistant ids make that the ONLY legitimate difference between their bytes.
    const normalise = (surface: Surface) => surface.delivered.replaceAll(surface.childID, "<child>")
    expect(surfaces.sync.childID).not.toBe(surfaces.async.childID)
    expect(normalise(surfaces.async)).toBe(normalise(surfaces.sync))

    return surfaces
  })

const absent = (surfaces: { sync: Surface; async: Surface }, ...texts: readonly string[]) => {
  for (const text of texts) {
    expect(surfaces.sync.delivered).not.toContain(text)
    expect(surfaces.async.delivered).not.toContain(text)
  }
}

// ---------------------------------------------------------------------------------------------
// The matrix
// ---------------------------------------------------------------------------------------------

const CANDIDATE: Spec = { key: "candidate", at: 1_000, text: "CANDIDATE-FINAL-ANSWER" }
const OBSERVED: Spec = { key: "observed", at: 900, text: "OBSERVED-EARLIER-TURN" }
const RUNFINAL: Spec = { key: "runfinal", at: 500, text: "RUNFINAL-RETAINED-FALLBACK" }
const EMPTY: Spec = { key: "empty", at: 1_000, text: "" }
const BLANK: Spec = { key: "blank", at: 1_000, text: "   \t  " }

describe("task selected-evidence parity across delivery surfaces (CP-032 A-1 / T-032-2)", () => {
  it.instance("candidate-selected evidence reaches both surfaces and outranks fallback and observed", () =>
    Effect.gen(function* () {
      const surfaces = yield* expectParity(
        { observed: OBSERVED, candidate: CANDIDATE, final: RUNFINAL },
        {
          controlling: CANDIDATE,
          candidate: CANDIDATE,
          observed: OBSERVED,
          fallback: RUNFINAL,
          degraded: false,
          everAttached: true,
        },
      )
      // The candidate carries a real final text, so it is the whole answer: the earlier observed
      // turn is retained in the record but contributes no second fact, and the run-final the owner
      // parked on — the yield — never reaches the caller on either surface.
      expect(surfaces.sync.delivered).toContain(CANDIDATE.text)
      expect(surfaces.async.delivered).toContain(CANDIDATE.text)
      absent(surfaces, RUNFINAL.text, OBSERVED.text)
    }),
  )

  it.instance("observed-selected evidence reaches both surfaces when no candidate exists", () =>
    Effect.gen(function* () {
      const surfaces = yield* expectParity(
        { observed: OBSERVED, final: RUNFINAL, wake: true },
        {
          controlling: OBSERVED,
          observed: OBSERVED,
          fallback: RUNFINAL,
          degraded: false,
          everAttached: true,
        },
      )
      // With no candidate, `select` prefers the observed turn over the retained run-final. The
      // fallback is present in the record and still must not be what either surface speaks.
      expect(surfaces.sync.delivered).toContain(OBSERVED.text)
      expect(surfaces.async.delivered).toContain(OBSERVED.text)
      absent(surfaces, RUNFINAL.text)
    }),
  )

  it.instance("an empty final candidate keeps the earlier observed turn as a second fact", () =>
    Effect.gen(function* () {
      const surfaces = yield* expectParity(
        { observed: OBSERVED, candidate: EMPTY, final: RUNFINAL },
        {
          controlling: EMPTY,
          candidate: EMPTY,
          observed: OBSERVED,
          fallback: RUNFINAL,
          degraded: false,
          earlierObserved: OBSERVED,
          everAttached: true,
        },
      )
      // Two facts: the selected turn was empty, AND here is what was observed before it. Collapsing
      // to the observed turn, or falling through to the retained run-final, loses one of them.
      expect(surfaces.sync.delivered).toContain(OBSERVED.text)
      absent(surfaces, RUNFINAL.text)
    }),
  )

  it.instance("a whitespace-only final candidate takes the same two-fact path as an empty one", () =>
    Effect.gen(function* () {
      // Empty and whitespace reach the notice through DIFFERENT halves of `text && text.trim()`: an
      // empty string is falsy, a whitespace one is truthy and fails the trim. Both are exercised
      // because a regression can repair one half and leave the other.
      const surfaces = yield* expectParity(
        { observed: OBSERVED, candidate: BLANK, final: RUNFINAL },
        {
          controlling: BLANK,
          candidate: BLANK,
          observed: OBSERVED,
          fallback: RUNFINAL,
          degraded: false,
          earlierObserved: OBSERVED,
          everAttached: true,
        },
      )
      expect(surfaces.sync.delivered).toContain(OBSERVED.text)
      absent(surfaces, RUNFINAL.text)
    }),
  )

  it.instance("degraded selected evidence keeps its status and warning on both surfaces", () =>
    Effect.gen(function* () {
      const surfaces = yield* expectParity(
        { observed: OBSERVED, candidate: CANDIDATE, final: RUNFINAL, degrade: true },
        {
          controlling: CANDIDATE,
          candidate: CANDIDATE,
          observed: OBSERVED,
          fallback: RUNFINAL,
          degraded: true,
          everAttached: true,
        },
      )
      absent(surfaces, RUNFINAL.text)

      // The fallback-only rebuild the observer used to perform, stated explicitly: it renders
      // without the warning and speaks the retained run-final. Naming it here makes the assertion
      // above a rejection of that exact historical shape rather than of an unspecified difference.
      const rebuilt = renderSelectedTask({
        sessionID: surfaces.async.childID,
        selected: {
          type: "evidence",
          fallback: assistantOf(RUNFINAL, surfaces.async.childID),
          degraded: false,
        },
      })
      expect(rebuilt).not.toContain("<task_warning>")
      expect(rebuilt).toContain(RUNFINAL.text)
      expect(surfaces.async.delivered).not.toBe(rebuilt)
    }),
  )

  it.instance("a never-attached scope resolves immediately on both surfaces", () =>
    Effect.gen(function* () {
      // A scope EXISTS with nothing outstanding — no jobs, no undelivered markers, no continuations,
      // no wakes. Eligibility must mint on the spot rather than park. Nothing in this row releases
      // anything, so an "a scope exists, therefore defer" regression cannot complete it at all.
      const surfaces = yield* expectParity(
        { observed: OBSERVED, candidate: CANDIDATE, final: RUNFINAL, immediate: true },
        {
          controlling: CANDIDATE,
          candidate: CANDIDATE,
          observed: OBSERVED,
          fallback: RUNFINAL,
          degraded: false,
          everAttached: false,
        },
      )
      expect(surfaces.sync.delivered).toContain(CANDIDATE.text)
      expect(surfaces.async.delivered).toContain(CANDIDATE.text)
      absent(surfaces, RUNFINAL.text, OBSERVED.text)
    }),
  )
})

describe("scope-less eligibility (CP-032 T-032-2 positive control)", () => {
  itScopeless.instance("a scope-less run is immediately eligible and renders its run-final inline", () =>
    Effect.gen(function* () {
      const coordinator = yield* AttachmentCoordinator.make
      const { chat, assistant } = yield* seed()
      const tool = yield* TaskTool
      const def = yield* tool.init()
      const scopes: Array<AttachmentCoordinator.Scope | undefined> = []

      const promptOps = baseOps({
        attachments: coordinator,
        prompt: (prompt) =>
          Effect.gen(function* () {
            if (prompt.sessionID === chat.id) return parentReply(prompt)
            scopes.push(prompt.attachmentScope)
            return assistantOf(RUNFINAL, prompt.sessionID)
          }),
      })

      const result = yield* def.execute(
        { description: "scope-less", prompt: "run", subagent_type: "general" },
        context({ sessionID: chat.id, messageID: assistant.id, promptOps }),
      )
      // Feature-off is the configuration in which no owner scope is opened, so this is the run that
      // reaches `eligible`'s scope-less branch and constructs its own evidence.
      expect(scopes).toEqual([undefined])
      const childID = result.metadata.sessionId
      expect(result.output).toBe(
        renderSelectedTask({
          sessionID: childID,
          selected: { type: "evidence", fallback: assistantOf(RUNFINAL, childID), degraded: false },
        }),
      )
      expect(result.output).toContain(RUNFINAL.text)
      expect(result.output).not.toContain("<task_warning>")
    }),
  )

  itScopeless.instance("born-async is unreachable without the flag that also guarantees an owner scope", () =>
    Effect.gen(function* () {
      const coordinator = yield* AttachmentCoordinator.make
      const { chat, assistant } = yield* seed()
      const tool = yield* TaskTool
      const def = yield* tool.init()
      const promptOps = baseOps({
        attachments: coordinator,
        prompt: (prompt) => Effect.succeed(assistantOf(RUNFINAL, prompt.sessionID)),
      })

      // WHY THERE IS NO SCOPE-LESS BORN-ASYNC ROW. Async admission requires
      // `experimentalBackgroundSubagents`, and with that flag on a fresh owner ALWAYS opens an
      // attachment scope. The two conditions are mutually exclusive in shipped source, so
      // "born-async without a scope" is not a gap in this matrix — it does not exist to test. The
      // capability half of the calibration is carried by the born-async positives above: a safeguard
      // that simply blocked async results would fail every one of them.
      const exit = yield* def
        .execute(
          { description: "scope-less async", prompt: "run", subagent_type: "general", async: true },
          context({ sessionID: chat.id, messageID: assistant.id, promptOps }),
        )
        .pipe(Effect.exit)
      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        expect(String(Cause.squash(exit.cause))).toContain("OPENCODE_EXPERIMENTAL_BACKGROUND_SUBAGENTS")
      }
    }),
  )
})
