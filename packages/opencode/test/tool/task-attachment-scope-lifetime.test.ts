import { afterEach, describe, expect } from "bun:test"
import { Deferred, Effect, Exit, Fiber, Layer } from "effect"
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
import { controllingAssistant, type TaskSelectedReturn } from "@/session/task-return"
import { TaskTool, type TaskPromptOps } from "@/tool/task"
import { Tool } from "@/tool/tool"
import { ToolRegistry } from "@/tool/registry"
import { ProviderTest } from "../fake/provider"
import { disposeAllInstances } from "../fixture/fixture"
import { admittingClosure, unusedJobs } from "../lib/closure"
import { recordingPhysical } from "../lib/physical"
import { awaitWithTimeout, pollWithTimeout, testEffect } from "../lib/effect"
import { SessionAdmission } from "@/session/closure/admission"
import { SessionClosure } from "@/session/closure/coordinator"
import { SessionClosureModel as Model } from "@/session/closure/model"

/**
 * REGRESSION GUARD: A FINISHED CHILD IS RESUMABLE IMMEDIATELY, WHATEVER DELIVERY IS DOING.
 *
 * THE RULE. The only thing that may decide whether a `Task(task_id=...)` resume is admitted is
 * whether that child sub-agent is currently ACTIVE. Not whether its result reached the parent.
 * Nothing about the caller. `task_id` resume IS the recovery path for when delivery goes wrong, so
 * it has to work precisely when delivery has failed, stalled, or been interrupted — the states that
 * used to hold the child unresumable.
 *
 * WHAT THIS FILE PROTECTS. The child's entry in the attachment coordinator is what makes
 * `attachments.open()` exclusive, so the entry's lifetime must equal the child's lifetime. The
 * entry is opened before `startExact` and so outlives the child's run; releasing it from an
 * `Effect.ensuring` bound to the whole observation is what created the window. The observation's
 * delivery step is `inject(...)`, a prompt into the PARENT, and a reply-required prompt into a
 * running session publishes a FIFO entry that cannot run until the active head ENDS (`prompt`
 * reaches `SessionRunState.publish`). A finished child
 * therefore stayed registered for the length of an entire parent run, and every resume inside that
 * window died with "Attachment scope already open for session <child>" from the coordinator's
 * exclusive open, surfaced as a hard tool error by `Effect.orDie` at the tool boundary. Observed in
 * practice: three such failures against one child, two of them inside a single six-minute parent
 * run, several assistant messages apart.
 *
 * THE FIX these tests guard lives in `attachObservation`: the release is bound to the child's
 * LIFETIME on its own fiber, so no delivery state can gate it.
 *
 * THE TRAP FOR A FUTURE EDIT — do not "simplify" this by moving the release back into the delivery
 * path. Releasing at a later point *inside* `observe` looks equivalent and is not: the ordinary
 * route injects each filed answer before it ever reaches its terminal branch, and `waitAnswer`
 * reports an answer with NO terminal info, so the observer is already parked in the parent before
 * it can learn the child is done. That placement was tried during this fix and left the bug fully
 * intact.
 *
 * WHY THE REST OF THE SUITE DOES NOT COVER THIS. "M4" in `task-attachment.test.ts` fences every
 * continuation acquisition, so no observer installs and the no-observer exit releases the entry at
 * once. M4's resume therefore succeeds for a reason that says nothing about the observed path.
 * These tests remove the fence and park the parent instead.
 */

const attachmentContinuationClosure: SessionClosure.Interface = {
  ...unusedJobs,
  request: () => Effect.die("unused"),
  view: Effect.die("unused"),
  identity: Effect.die("unused"),
  acquire: () =>
    Effect.succeed({
      type: "admitted" as const,
      lease: Model.id("lease", "lease_scope_lifetime"),
      epoch: 0n,
      instance: Model.id("instance", "instance_scope_lifetime"),
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
  ]),
  [
    // Every test here exercises attachment, which is reached only with the flag on.
    [RuntimeFlags.node, RuntimeFlags.layer({ experimentalBackgroundSubagents: true })],
    [Provider.node, providerLayer],
    // The background binder resolves whichever coordinator the layer provides, so the fake that
    // admits every bind must be the one it finds; otherwise every job is refused as
    // `refused_by_authority` and surfaces as a cancelled task.
    [SessionClosure.node, admittingClosure],
  ],
)

const it = testEffect(layer)

// RuntimeFlags are compiled into the layer, not selected per test. The feature-off R-08 control
// therefore owns a second same-file layer rather than pretending a per-test config can change it.
const layerOff = LayerNode.compile(
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
  ]),
  [
    [RuntimeFlags.node, RuntimeFlags.layer({ experimentalBackgroundSubagents: false })],
    [Provider.node, providerLayer],
    [SessionClosure.node, admittingClosure],
  ],
)

const itOff = testEffect(layerOff)

/**
 * A persisted user+assistant pair in an EXISTING session. Task resolves `ctx.messageID` against
 * durable storage, so a freshly minted id fails with "Message not found" — which is what a nested
 * Task launched from inside a child's run needs this for.
 */
const seedAssistant = Effect.fn("TaskScopeLifetimeTest.seedAssistant")(function* (sessionID: SessionID, agent: string) {
  const sessions = yield* Session.Service
  const user = yield* sessions.updateMessage({
    id: MessageID.ascending(),
    role: "user",
    sessionID,
    agent,
    model: ref,
    time: { created: Date.now() },
  })
  const assistant: SessionV1.Assistant = {
    id: MessageID.ascending(),
    role: "assistant",
    parentID: user.id,
    sessionID,
    mode: agent,
    agent,
    cost: 0,
    path: { cwd: "/tmp", root: "/tmp" },
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    modelID: ref.modelID,
    providerID: ref.providerID,
    time: { created: Date.now() },
  }
  yield* sessions.updateMessage(assistant)
  return assistant
})

const seed = Effect.fn("TaskScopeLifetimeTest.seed")(function* () {
  const sessions = yield* Session.Service
  const chat = yield* sessions.create({ title: "Caller" })
  const assistant = yield* seedAssistant(chat.id, "build")
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

/** Production fires `onAdmitted` after durable persistence; a fixture that skips it parks same-ID calls. */
function admittingOps(ops: TaskPromptOps): TaskPromptOps {
  return {
    ...ops,
    prompt: (input) => (input.onAdmitted ?? Effect.void).pipe(Effect.andThen(Effect.suspend(() => ops.prompt(input)))),
  }
}

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
    extra: { promptOps: admittingOps(input.promptOps), attachment: input.attachment },
    messages: [],
    metadata: () => Effect.void,
    ask: () => Effect.void,
  }
}

function promptText(input: SessionPrompt.PromptInput) {
  return input.parts.findLast((part) => part.type === "text")?.text ?? ""
}

function basicOps(input: {
  prompt: TaskPromptOps["prompt"]
  attachments: AttachmentCoordinator.Interface
}): TaskPromptOps {
  return {
    acquireContinuation: (call) => SessionAdmission.acquireContinuation(attachmentContinuationClosure, call),
    admitScoped: (call) => SessionAdmission.admitScoped(attachmentContinuationClosure, call),
    attachments: input.attachments,
    cancel: () => Effect.void,
    physical: recordingPhysical(),
    resolvePromptParts: (template) => Effect.succeed([{ type: "text" as const, text: template }]),
    prompt: input.prompt,
  }
}

/**
 * `task-return.ts:31-33`, verbatim. This string is the PRODUCT-VISIBLE consequence of
 * `exhaustWake()` degrading a scope, so a row that claims degradation asserts the text a caller
 * actually receives rather than an internal flag.
 */
const DEGRADED_WARNING =
  "Attachment coordination degraded. Returning the best observed output; background work was not interrupted."

/**
 * A gate factory whose gates are ALL released when the surrounding test scope closes — including on
 * a failed assertion.
 *
 * The rows below hold real production fibers on Deferreds: a run parked in `ops.prompt`, an observer
 * parked in `ops.wake`, a supplement parked in `Scope.result()`. `it.instance` is UNBOUNDED — only
 * `itBounded` races a body against `FIBER_BOUND_MILLIS` (`test/lib/effect.ts`) — so an assertion
 * that fails while a gate is still shut leaves those fibers parked forever and WEDGES THE RUNNER
 * instead of reporting the failure. The release is unconditional and idempotent: `Deferred.succeed`
 * on an already-completed gate is a no-op, so gates the body opened itself cost nothing here.
 */
const gates = Effect.gen(function* () {
  const opened: Deferred.Deferred<void>[] = []
  yield* Effect.addFinalizer(() =>
    Effect.all(
      opened.map((one) => Deferred.succeed(one, undefined)),
      { discard: true },
    ),
  )
  return Effect.gen(function* () {
    const made = yield* Deferred.make<void>()
    opened.push(made)
    return made
  })
})

describe("task attachment owner-scope lifetime", () => {
  it.instance("a finished child is resumable while the parent is still mid-delivery", () =>
    Effect.gen(function* () {
      const jobs = yield* BackgroundJob.Service
      const coordinator = yield* AttachmentCoordinator.make
      const { chat, assistant } = yield* seed()
      const tool = yield* TaskTool
      const def = yield* tool.init()

      // `injectStarted` is the PUBLISHED READINESS SIGNAL (test/AGENTS.md, "Synchronizing With
      // Concurrent Work") that the observer's delivery into the parent has actually begun.
      // `injectRelease` is what the parent finally going idle looks like from here. `parentBusy`
      // is the load-bearing one: it records that the parent had NOT finished while the assertions
      // ran, so "the resume was admitted" cannot be satisfied by a parent that quietly completed
      // first. A bare `Effect.never` would model the park but could never be released.
      const injectStarted = yield* Deferred.make<void>()
      const injectRelease = yield* Deferred.make<void>()
      const parentBusy = { value: false }
      const parentPrompts: SessionPrompt.PromptInput[] = []

      const promptOps = basicOps({
        attachments: coordinator,
        prompt: (input) =>
          input.sessionID === chat.id
            ? Effect.gen(function* () {
                parentPrompts.push(input)
                parentBusy.value = true
                yield* Deferred.succeed(injectStarted, undefined)
                yield* Deferred.await(injectRelease)
                parentBusy.value = false
                return reply(input, "parent continuation")
              })
            : Effect.succeed(reply(input, "child done")),
      })

      const started = yield* def.execute(
        { description: "born async", prompt: "run", subagent_type: "general", async: true },
        context({ sessionID: chat.id, messageID: assistant.id, promptOps }),
      )
      expect(started.metadata.background).toBe(true)
      const child = started.metadata.sessionId

      // The child is DONE. From here `extendWithHandle` answers `undefined` for this id, which is
      // what routes a resume into the replacement-start branch and its exclusive open.
      const waited = yield* jobs.wait({ id: child, timeout: 5_000 })
      expect(waited.timedOut).toBe(false)
      expect(waited.info?.status).toBe("completed")

      // Positive precondition: an observer really installed and really reached the parent, so what
      // follows describes the OBSERVED path rather than an observer that never ran.
      yield* awaitWithTimeout(
        Deferred.await(injectStarted),
        "the async observer never delivered into the parent session",
        "10 seconds",
      )
      expect(parentPrompts).toHaveLength(1)
      expect(parentBusy.value).toBe(true)

      // (1) The registration is gone once the child stopped being ACTIVE — not once delivery ended.
      yield* pollWithTimeout(
        Effect.gen(function* () {
          return (yield* coordinator.locate(child)) === undefined ? true : undefined
        }),
        "the child stayed registered after its lifetime ended",
        "10 seconds",
      )

      // (2) THE RULE. The resume is admitted even though delivery is still parked in the parent.
      const resumed = yield* def.execute(
        { description: "resume mid-delivery", prompt: "again", subagent_type: "general", task_id: child },
        context({ sessionID: chat.id, messageID: assistant.id, promptOps }),
      )
      expect(resumed.output).toContain("child done")
      expect(resumed.output).toContain('state="completed"')

      // (3) CONTROL. A Task creating a brand-new session also succeeds, so (2) is not being read
      // off a Task that would succeed for anything.
      const sibling = yield* def.execute(
        { description: "fresh sibling", prompt: "sibling", subagent_type: "general" },
        context({ sessionID: chat.id, messageID: assistant.id, promptOps }),
      )
      expect(sibling.output).toContain("child done")
      expect(sibling.metadata.sessionId).not.toBe(child)

      // (4) THE CONDITION HELD THROUGHOUT. The parent never went idle during (1)-(3), and it was
      // never prompted a second time, so nothing above was admitted because delivery had finished.
      expect(parentBusy.value).toBe(true)
      expect(parentPrompts).toHaveLength(1)

      yield* Deferred.succeed(injectRelease, undefined)
    }),
  )

  /**
   * The rule's whole point is RECOVERY, so the states where delivery went wrong matter more than
   * the happy one. Each case below leaves the child finished and the delivery broken in a different
   * way, and each must still admit a resume.
   */
  it.instance("a child whose delivery into the parent FAILS is still resumable", () =>
    Effect.gen(function* () {
      const jobs = yield* BackgroundJob.Service
      const coordinator = yield* AttachmentCoordinator.make
      const { chat, assistant } = yield* seed()
      const tool = yield* TaskTool
      const def = yield* tool.init()
      const attempted = yield* Deferred.make<void>()

      const promptOps = basicOps({
        attachments: coordinator,
        prompt: (input) =>
          input.sessionID === chat.id
            ? // The delivery blows up rather than parking. The observer's `catchCause` swallows it,
              // so nothing else will ever release this child — which is exactly the state the user
              // named: "things can go wrong with delivery and recovery means task_id resume".
              Deferred.succeed(attempted, undefined).pipe(Effect.andThen(Effect.die(new Error("delivery exploded"))))
            : Effect.succeed(reply(input, "child done")),
      })

      const started = yield* def.execute(
        { description: "delivery fails", prompt: "run", subagent_type: "general", async: true },
        context({ sessionID: chat.id, messageID: assistant.id, promptOps }),
      )
      const child = started.metadata.sessionId
      expect((yield* jobs.wait({ id: child, timeout: 5_000 })).info?.status).toBe("completed")
      yield* awaitWithTimeout(Deferred.await(attempted), "delivery was never attempted", "10 seconds")

      yield* pollWithTimeout(
        Effect.gen(function* () {
          return (yield* coordinator.locate(child)) === undefined ? true : undefined
        }),
        "a child whose delivery failed stayed registered",
        "10 seconds",
      )
      const resumed = yield* def.execute(
        { description: "recover after failed delivery", prompt: "again", subagent_type: "general", task_id: child },
        context({ sessionID: chat.id, messageID: assistant.id, promptOps }),
      )
      expect(resumed.output).toContain("child done")
    }),
  )

  it.instance("a child that ERRORED is resumable while the parent is still mid-delivery", () =>
    Effect.gen(function* () {
      const jobs = yield* BackgroundJob.Service
      const coordinator = yield* AttachmentCoordinator.make
      const { chat, assistant } = yield* seed()
      const tool = yield* TaskTool
      const def = yield* tool.init()
      const injectStarted = yield* Deferred.make<void>()
      const injectRelease = yield* Deferred.make<void>()
      const failing = { value: true }

      const promptOps = basicOps({
        attachments: coordinator,
        prompt: (input) =>
          input.sessionID === chat.id
            ? Deferred.succeed(injectStarted, undefined).pipe(
                Effect.andThen(Deferred.await(injectRelease)),
                Effect.as(reply(input, "parent continuation")),
              )
            : failing.value
              ? Effect.die(new Error("child exploded"))
              : Effect.succeed(reply(input, "child done")),
      })

      const started = yield* def.execute(
        { description: "child errors", prompt: "run", subagent_type: "general", async: true },
        context({ sessionID: chat.id, messageID: assistant.id, promptOps }),
      )
      const child = started.metadata.sessionId
      expect((yield* jobs.wait({ id: child, timeout: 5_000 })).info?.status).toBe("error")
      yield* awaitWithTimeout(Deferred.await(injectStarted), "the error envelope was never delivered", "10 seconds")

      // An errored child is just as inactive as a completed one, so the rule applies unchanged.
      yield* pollWithTimeout(
        Effect.gen(function* () {
          return (yield* coordinator.locate(child)) === undefined ? true : undefined
        }),
        "an errored child stayed registered while its envelope was being delivered",
        "10 seconds",
      )
      failing.value = false
      const resumed = yield* def.execute(
        { description: "retry after error", prompt: "again", subagent_type: "general", task_id: child },
        context({ sessionID: chat.id, messageID: assistant.id, promptOps }),
      )
      expect(resumed.output).toContain("child done")
      yield* Deferred.succeed(injectRelease, undefined)
    }),
  )

  it.instance("a child that is still RUNNING stays registered and takes a supplemental prompt", () =>
    Effect.gen(function* () {
      const coordinator = yield* AttachmentCoordinator.make
      const { chat, assistant } = yield* seed()
      const tool = yield* TaskTool
      const def = yield* tool.init()
      const childStarted = yield* Deferred.make<void>()
      const childRelease = yield* Deferred.make<void>()

      const promptOps = basicOps({
        attachments: coordinator,
        prompt: (input) =>
          input.sessionID === chat.id
            ? Effect.succeed(reply(input, "parent continuation"))
            : Deferred.succeed(childStarted, undefined).pipe(
                Effect.andThen(Deferred.await(childRelease)),
                Effect.as(reply(input, "child done")),
              ),
      })

      const started = yield* def.execute(
        { description: "long child", prompt: "run", subagent_type: "general", async: true },
        context({ sessionID: chat.id, messageID: assistant.id, promptOps }),
      )
      const child = started.metadata.sessionId
      yield* awaitWithTimeout(Deferred.await(childStarted), "the child never started", "10 seconds")

      // The OTHER half of the rule: while the child IS active the registration must persist, both
      // because that is what it means and because `executeSupplement` borrows this exact scope.
      expect(yield* coordinator.locate(child)).toBeDefined()

      // A resume against a live child is a supplemental prompt, not a replacement start, and it is
      // admitted immediately rather than waiting for anything.
      const resumed = yield* def.execute(
        { description: "supplement a live child", prompt: "more", subagent_type: "general", task_id: child },
        context({ sessionID: chat.id, messageID: assistant.id, promptOps }),
      )
      expect(resumed.output).toContain('state="running"')
      expect(resumed.metadata.background).toBe(true)
      expect(yield* coordinator.locate(child)).toBeDefined()

      yield* Deferred.succeed(childRelease, undefined)
    }),
  )

  /**
   * THE NESTED CASE — does anything still NEED the child's scope after the child terminalizes?
   *
   * The child C is handed its own scope for its run (the run's `attachmentScope` is C's invocation
   * scope). If C uses it to launch an ATTACHED async grandchild G, G's observer holds a reservation on
   * C's scope and must later reach back through it to deliver G's result into C — an event that by
   * construction happens after C's own run has ended.
   *
   * This test establishes empirically whether that delivery survives C's scope being finalized. It
   * does NOT park the top-level parent, so C's observer completes promptly and the scope is
   * finalized on the ordinary path — the common case, not a contrived one.
   *
   * RESULT: it survives, downgraded. Source reading predicted the delivery would be dropped where
   * the observer reads `terminal()`, which returns undefined on a closed scope; the degraded-scope
   * branch is reached first and routes the same content through ordinary notification.
   */
  // T-032-1. This WAS "a grandchild attached to the child still delivers after the child's scope is
  // finalized", and it asserted the incident as correct behaviour: the child lifetime completing on
  // a yield, the owner scope disappearing while the grandchild ran, and the grandchild's result
  // arriving through the degraded ordinary route with `attached: false`. Each of those is now the
  // negative. Re-framed rather than patched, because every one of its outcomes moved.
  it.instance(
    "a child that yields with an attached grandchild files nothing until it is eligible",
    () =>
      Effect.gen(function* () {
        const jobs = yield* BackgroundJob.Service
        const sessions = yield* Session.Service
        const coordinator = yield* AttachmentCoordinator.make
        const { chat, assistant } = yield* seed()
        const tool = yield* TaskTool
        const def = yield* tool.init()

        const grandchildStarted = yield* Deferred.make<void>()
        const childRelease = yield* Deferred.make<void>()
        const grandchildRelease = yield* Deferred.make<void>()
        const childScope: { value?: AttachmentCoordinator.Scope } = {}
        const childID: { value?: SessionID } = {}
        const grandchildID: { value?: SessionID } = {}
        // Anything prompted into a session that is not one of the two task prompts is a DELIVERY —
        // an observer injecting a finished task's result back into its caller session.
        const deliveries: Array<{ sessionID: SessionID; text: string; attached: boolean }> = []
        const holder: { value?: TaskPromptOps } = {}

        const promptOps = basicOps({
          attachments: coordinator,
          prompt: (input) =>
            Effect.gen(function* () {
              const text = promptText(input)
              if (text === "child-work") {
                childID.value = input.sessionID
                childScope.value = input.attachmentScope
                // C launches an attached async grandchild using the very scope its own run was handed.
                // The service is provided explicitly: `TaskPromptOps["prompt"]` is typed with no
                // requirements, so seeding the anchor message inside the fixture must carry its own.
                const anchor = yield* seedAssistant(input.sessionID, "general").pipe(
                  Effect.provideService(Session.Service, sessions),
                )
                const g = yield* def.execute(
                  { description: "grandchild", prompt: "grandchild-work", subagent_type: "general", async: true },
                  context({
                    sessionID: input.sessionID,
                    messageID: anchor.id,
                    promptOps: holder.value!,
                    attachment: input.attachmentScope,
                  }),
                )
                grandchildID.value = g.metadata.sessionId
                yield* Deferred.succeed(grandchildStarted, undefined)
                yield* Deferred.await(childRelease)
                return reply(input, "child done")
              }
              if (text === "grandchild-work") {
                yield* Deferred.await(grandchildRelease)
                return reply(input, "grandchild done")
              }
              deliveries.push({ sessionID: input.sessionID, text, attached: input.attachmentScope !== undefined })
              return reply(input, "delivered")
            }),
        })
        holder.value = promptOps

        const started = yield* def.execute(
          { description: "child", prompt: "child-work", subagent_type: "general", async: true },
          context({ sessionID: chat.id, messageID: assistant.id, promptOps }),
        )
        const child = started.metadata.sessionId
        yield* awaitWithTimeout(
          Deferred.await(grandchildStarted),
          "the child never launched a grandchild",
          "10 seconds",
        )
        expect(childID.value).toBe(child)
        expect(grandchildID.value).toBeDefined()

        // PRECONDITION: the grandchild really is an ATTACHED observer on the child's live scope, not
        // an ordinary root task that merely happens to be running. Without this, "no delivery" below
        // would be satisfied by an attachment that never formed.
        const scope = childScope.value
        if (!scope) return yield* Effect.die("the child's run was not handed an attachment scope")
        yield* pollWithTimeout(
          Effect.sync(() => (scope.current().everAttached ? true : undefined)),
          "the grandchild never claimed observer ownership on the child's scope",
          "10 seconds",
        )
        expect(scope.current().attached).toBeGreaterThanOrEqual(1)

        // PHASE 1 — the child ends a provider turn while its grandchild is still outstanding.
        // CP-021 calls that turn-end a YIELD: the child owes its caller a final response and has not
        // produced it yet.
        yield* Deferred.succeed(childRelease, undefined)

        // PHASE 2 — the yield is NOT an answer. This is the calibrating negative control, and it is
        // the whole incident: CP-031 filed this turn, terminalized the outer lifetime on it, closed
        // the owner scope, and the child's real return had no observer left to reach the parent.
        //
        // The lifetime stays non-terminal with NO wall-clock timeout, observer poll, or synthetic
        // successor run forcing it. Duration cannot establish return eligibility, so this asserts a
        // bounded settle rather than pretending to prove "indefinitely" — the absence of any polling
        // or timeout mechanism is a source property, censused separately.
        for (let attempt = 0; attempt < 500; attempt++) yield* Effect.yieldNow
        const parked = yield* jobs.wait({ id: child, timeout: 250 })
        expect(parked.timedOut).toBe(true)
        expect(parked.info?.status).toBe("running")
        expect(deliveries.filter((entry) => entry.sessionID === chat.id)).toHaveLength(0)

        // PHASE 3 — the owner scope stays REGISTERED while eligibility is parked. The premature close
        // is what unregistered it, and every `Task(task_id=child)` in that window then died on the
        // coordinator's exclusive open.
        const located = yield* coordinator.locate(child)
        expect(located).toBeDefined()
        expect(located?.id).toBe(scope.id)
        // Unresolved is proven through OUTCOMES, never a Task-facing resolution sample (CP-032 R-13):
        // the lifetime is still running with zero deliveries above, and the scope still holds the
        // grandchild's outstanding attachment here, which is why eligibility cannot have resolved.
        expect(located?.current()).toMatchObject({ attached: 1, failed: false, cancelled: false })

        // PHASE 4 — the grandchild finishes and reaches the child through the STILL-LIVE attachment
        // route, not the degraded ordinary one. The old oracle canonized `attached: false` here.
        yield* Deferred.succeed(grandchildRelease, undefined)
        const grandchild = grandchildID.value!
        expect((yield* jobs.wait({ id: grandchild, timeout: 5_000 })).info?.status).toBe("completed")
        yield* pollWithTimeout(
          Effect.sync(() => (deliveries.some((entry) => entry.sessionID === child) ? true : undefined)),
          "the grandchild result never reached the child",
          "10 seconds",
        )
        const intoChild = deliveries.filter((entry) => entry.sessionID === child)
        expect(intoChild).toHaveLength(1)
        expect(intoChild[0]?.text).toContain("grandchild done")
        expect(intoChild[0]?.attached).toBe(true)

        // PHASE 5 — with the grandchild quiesced the child becomes eligible, terminalizes, and
        // delivers EXACTLY ONE answer to the original parent: its final response, never the yield.
        const settled = yield* jobs.wait({ id: child, timeout: 10_000 })
        expect(settled.info?.status).toBe("completed")
        yield* pollWithTimeout(
          Effect.sync(() => (deliveries.some((entry) => entry.sessionID === chat.id) ? true : undefined)),
          "the child's eligible answer never reached the original parent",
          "10 seconds",
        )
        for (let attempt = 0; attempt < 200; attempt++) yield* Effect.yieldNow
        const intoParent = deliveries.filter((entry) => entry.sessionID === chat.id)
        expect(intoParent).toHaveLength(1)
        expect(intoParent[0]?.text).toContain("child done")

        // PHASE 6 — the scope is released on the LIFETIME terminal, and the child stays addressable.
        yield* pollWithTimeout(
          Effect.gen(function* () {
            return (yield* coordinator.locate(child)) === undefined ? true : undefined
          }),
          "the child's owner scope never released after its lifetime terminalized",
          "10 seconds",
        )
      }),
    // This case is about what happens to an attached grandchild's delivery, so the nesting it
    // exercises has to be permitted: at the default depth of 1 the grandchild is refused before any
    // attachment forms, and the test would pass on a scenario it never built.
    { config: { subagent_depth: 2 } },
  )

  /**
   * T-032-1 ITEMS 6-7 — WHAT THE ATTACHED INGRESS LEAVES BEHIND, AND WHAT THE WAKE DOES ABOUT IT.
   *
   * The row above proves the yield does not file and that the eligible answer arrives exactly once.
   * It says nothing about HOW eligibility resolves once the grandchild's result reaches the parked
   * child: its controlled PromptOps never calls production `observeTurn`, and it asserts neither a
   * wake transition nor the degraded warning. That is this pair's subject, and the two arms are the
   * two states an attached ingress can leave the scope in.
   *
   *   CLEAN        the injected run installs a current-generation candidate. `needsWake()` is false
   *                BECAUSE that candidate exists (`coordinator.ts:545`), so the wake block at
   *                `task.ts:789-795` asks `beginWake()`, is answered `false`, and neither wakes nor
   *                exhausts. The candidate is selected and the answer carries no warning.
   *
   *   NO-EVIDENCE  the injected run installs neither candidate nor observed. `needsWake()` is true,
   *                the one wake is claimed, `ops.wake` gets its provider turn, and the wake is then
   *                exhausted with nothing to show for it — the ONLY route by which `exhaustWake()`
   *                degrades a live scope (`coordinator.ts:562-568`). The answer carries the retained
   *                fallback and the exact degraded warning.
   *
   * The scope is INSTRUMENTED rather than sampled, because `beginWake()`'s boolean is the fact under
   * test and no `Current` field carries it. Every instrumented method delegates to the real one and
   * records what it actually returned; `wake.depth`/`wake.peak` MIRROR the coordinator's own
   * `state.wakes` by its own rules (a true `beginWake` increments, `endWake` decrements) rather than
   * reading it. `wake.provider` is a second, independent witness that needs no mirror: production
   * reaches `ops.wake` only inside the `beginWake()` branch, so it counts true claims directly.
   */
  const wakeEligibility = (mode: "clean" | "no-evidence") =>
    Effect.gen(function* () {
      const jobs = yield* BackgroundJob.Service
      const sessions = yield* Session.Service
      const coordinator = yield* AttachmentCoordinator.make
      const { chat, assistant } = yield* seed()
      const tool = yield* TaskTool
      const def = yield* tool.init()

      const gate = yield* gates
      const childRelease = yield* gate
      const grandchildStarted = yield* gate
      const grandchildRelease = yield* gate
      const ingressStarted = yield* gate
      const ingressRelease = yield* gate
      const wakeStarted = yield* gate
      const wakeRelease = yield* gate
      const parentDelivered = yield* gate
      const child: { id?: SessionID; scope?: AttachmentCoordinator.Scope } = {}
      const holder: { value?: TaskPromptOps } = {}
      const ingress: Array<{ text: string; attached: boolean }> = []
      const deliveries: string[] = []
      const openedFor: SessionID[] = []
      // `depth`/`peak` mirror the coordinator's `state.wakes`; `provider` counts `ops.wake` turns.
      const wake = { begins: [] as boolean[], depth: 0, peak: 0, ends: 0, exhausts: 0, provider: 0 }
      const observation = {
        calls: 0,
        clean: [] as boolean[],
        assistant: undefined as SessionV1.WithParts | undefined,
        // `-1` is unreachable as a real epoch (they start at 0 and only ever increment), so an
        // uncaptured observation stays distinguishable from a captured generation-0 one.
        epoch: -1,
      }
      // The wake's provider turn returns a message like any other prompt, so it reuses the ingress
      // input rather than minting a second message shape. The wake can only follow the ingress
      // (`task.ts:782` delivers before `:791` asks), so this is always populated by then.
      const lastIngress: { input?: SessionPrompt.PromptInput } = {}

      const wrap = (scope: AttachmentCoordinator.Scope): AttachmentCoordinator.Scope => {
        const instrumented: AttachmentCoordinator.Scope = {
          ...scope,
          // `Effect.suspend`, not a bare block body: the counters have to move when the effect RUNS,
          // or merely constructing one would record an observation that never reached the scope.
          observeTurn: (input) =>
            Effect.suspend(() => {
              observation.calls++
              observation.clean.push(input.clean)
              observation.assistant = input.assistant
              return scope.observeTurn(input)
            }),
          beginWake: () =>
            scope.beginWake().pipe(
              Effect.tap((claimed) =>
                Effect.sync(() => {
                  wake.begins.push(claimed)
                  if (!claimed) return
                  wake.depth++
                  wake.peak = Math.max(wake.peak, wake.depth)
                }),
              ),
            ),
          endWake: () =>
            scope.endWake().pipe(
              Effect.tap(() =>
                Effect.sync(() => {
                  wake.ends++
                  if (wake.depth > 0) wake.depth--
                }),
              ),
            ),
          exhaustWake: () =>
            Effect.suspend(() => {
              wake.exhausts++
              return scope.exhaustWake()
            }),
        }
        child.scope = instrumented
        return instrumented
      }

      // Task reconciles a delegated call's CARRIED scope against `locate`'s answer BY REFERENCE
      // (`task.ts:296-303`) and fails the call on disagreement, so the instrumented wrapper has to
      // be what the open AND both lookups return. The registry keeps the raw scope, which is
      // correct: `closeNow` unregisters by `scope.id` (`coordinator.ts:349`) and the wrapper carries
      // the same id. Matching on that id rather than on the session keeps the mapping exact.
      const wrapperFor = (scope: AttachmentCoordinator.Scope | undefined) =>
        scope && child.scope?.id === scope.id ? child.scope : scope
      const attachments: AttachmentCoordinator.Interface = {
        ...coordinator,
        open: (sessionID) =>
          coordinator.open(sessionID).pipe(
            Effect.map((scope) => {
              openedFor.push(sessionID)
              // The child's own scope is the first opened: `task.ts:1039` runs before its run can
              // launch anything. The grandchild opens its own, and that one is left raw.
              return openedFor.length === 1 ? wrap(scope) : scope
            }),
          ),
        locate: (sessionID) => coordinator.locate(sessionID).pipe(Effect.map(wrapperFor)),
        locateBorrowable: (sessionID) => coordinator.locateBorrowable(sessionID).pipe(Effect.map(wrapperFor)),
      }

      const promptOps: TaskPromptOps = {
        ...basicOps({
          attachments,
          prompt: (input) =>
            Effect.gen(function* () {
              const text = promptText(input)
              if (text === `wake-${mode}-owner`) {
                child.id = input.sessionID
                if (!input.attachmentScope) return yield* Effect.die("wake owner had no attachment scope")
                const anchor = yield* seedAssistant(input.sessionID, "general").pipe(
                  Effect.provideService(Session.Service, sessions),
                )
                yield* def.execute(
                  {
                    description: `wake ${mode} descendant`,
                    prompt: `wake-${mode}-descendant`,
                    subagent_type: "general",
                    async: true,
                  },
                  context({
                    sessionID: input.sessionID,
                    messageID: anchor.id,
                    promptOps: holder.value!,
                    attachment: input.attachmentScope,
                  }),
                )
                yield* Deferred.succeed(grandchildStarted, undefined)
                yield* Deferred.await(childRelease)
                return reply(input, `wake ${mode} owner fallback`)
              }
              if (text === `wake-${mode}-descendant`) {
                yield* Deferred.await(grandchildRelease)
                return reply(input, `wake ${mode} descendant answer`)
              }
              if (child.id && input.sessionID === child.id) {
                // THE ATTACHED INGRESS: the grandchild's observer injecting its result back into the
                // parked child through the child's own scope, which is the attached branch of the
                // split at `task.ts:766-782`.
                lastIngress.input = input
                ingress.push({ text, attached: input.attachmentScope !== undefined })
                const response = reply(
                  input,
                  mode === "clean" ? "clean current-generation candidate" : "ingress without accepted evidence",
                )
                if (mode === "clean") {
                  if (!input.attachmentScope) return yield* Effect.die("clean ingress lost its attachment scope")
                  // What `prompt.ts:1528-1546` does for a real run, at the same point in the same
                  // scope: the injected run's final Assistant is this generation's clean candidate.
                  yield* input.attachmentScope.observeTurn({ assistant: response, clean: true })
                  // Captured at the instant of observation. `state.candidate` records the epoch it
                  // was taken under, and `gate()` refuses to publish a candidate whose epoch has
                  // since moved (`coordinator.ts:338`), so comparing this against the epoch at
                  // publication is what makes "current generation" an assertion rather than a hope.
                  observation.epoch = input.attachmentScope.current().epoch
                }
                yield* Deferred.succeed(ingressStarted, undefined)
                yield* Deferred.await(ingressRelease)
                return response
              }
              if (input.sessionID === chat.id) {
                deliveries.push(text)
                yield* Deferred.succeed(parentDelivered, undefined)
                return reply(input, "parent accepted wake result")
              }
              return reply(input, "unrelated wake delivery")
            }),
        }),
        // Production's wake performs a real provider turn in the child session and returns its
        // message (`prompt.ts:217-230`), so this returns one too. It deliberately observes NOTHING:
        // a wake turn that produces no evidence is precisely the state `exhaustWake()` exists to
        // resolve, and it is the state this arm needs when it reaches `task.ts:795`.
        wake: () =>
          Effect.gen(function* () {
            wake.provider++
            yield* Deferred.succeed(wakeStarted, undefined)
            yield* Deferred.await(wakeRelease)
            return reply(lastIngress.input!, "wake turn produced no further evidence")
          }),
      }
      holder.value = promptOps

      const started = yield* def.execute(
        {
          description: `wake ${mode} owner`,
          prompt: `wake-${mode}-owner`,
          subagent_type: "general",
          async: true,
        },
        context({ sessionID: chat.id, messageID: assistant.id, promptOps }),
      )
      const owner = started.metadata.sessionId
      yield* awaitWithTimeout(Deferred.await(grandchildStarted), `${mode} owner never launched its descendant`)
      const scope = child.scope
      if (!scope || child.id !== owner)
        return yield* Effect.die(`${mode} wake topology did not capture the owner scope`)
      // Two scopes, one each: the child's own, and the grandchild's. The instrumented one is the
      // child's, which is the scope the wake block will act on.
      expect(openedFor).toHaveLength(2)
      expect(openedFor[0]).toBe(owner)
      expect(openedFor[1]).not.toBe(owner)
      expect(scope.current()).toMatchObject({ attached: 1, everAttached: true, failed: false, cancelled: false })

      // PHASE 1 — the child yields with its grandchild outstanding, so eligibility parks.
      yield* Deferred.succeed(childRelease, undefined)
      expect((yield* jobs.wait({ id: owner, timeout: 250 })).timedOut).toBe(true)
      expect(deliveries).toHaveLength(0)

      // PHASE 2 — the grandchild settles and its result enters the parked child through the
      // ATTACHED branch, which is the precondition for the wake block being reached at all.
      yield* Deferred.succeed(grandchildRelease, undefined)
      yield* awaitWithTimeout(Deferred.await(ingressStarted), `${mode} descendant never entered its owner`)
      expect(ingress).toHaveLength(1)
      expect(ingress[0]?.attached).toBe(true)
      expect(ingress[0]?.text).toContain(`wake ${mode} descendant answer`)
      expect(deliveries).toHaveLength(0)
      expect((yield* jobs.wait({ id: owner, timeout: 250 })).info?.status).toBe("running")

      // PHASE 3 — what the ingress left behind. This is the arms' ONLY difference, and it is the
      // whole input to the wake decision: `needsWake()` is false exactly when a candidate exists.
      if (mode === "clean") {
        expect(observation.calls).toBe(1)
        expect(observation.clean).toEqual([true])
        expect(observation.assistant?.parts.findLast((part) => part.type === "text")?.text).toBe(
          "clean current-generation candidate",
        )
        expect(scope.current().candidate).toBe(true)
        // CURRENT generation, not merely present: nothing reserved between the observation and here,
        // so the candidate's epoch still equals the scope's and `gate()` will not discard it.
        expect(observation.epoch).toBeGreaterThanOrEqual(0)
        expect(scope.current().epoch).toBe(observation.epoch)
      } else {
        expect(observation.calls).toBe(0)
        expect(scope.current().candidate).toBe(false)
      }

      // PHASE 4 — the wake decision at `task.ts:791`. `beginWake()` is asked in BOTH arms; only its
      // answer differs, and only a true answer reaches `ops.wake`.
      yield* Deferred.succeed(ingressRelease, undefined)

      // Opened immediately in the clean arm, where a correct product never takes a wake at all so
      // nothing awaits it. It matters only when something is WRONG: a regression that claims a wake
      // here would otherwise park on a gate this arm never opens and report as a timeout instead of
      // as the wake-accounting failure it is.
      if (mode === "clean") yield* Deferred.succeed(wakeRelease, undefined)

      if (mode === "no-evidence") {
        yield* awaitWithTimeout(Deferred.await(wakeStarted), "no-evidence ingress never began its real wake")
        expect(wake.begins).toEqual([true])
        expect(wake.provider).toBe(1)
        expect(wake.depth).toBe(1)
        expect(wake.peak).toBe(1)
        expect(wake.ends).toBe(0)
        expect(wake.exhausts).toBe(0)
        // The claimed wake is what holds the gate shut (`coordinator.ts:337`): while the caller
        // still owes a turn, nothing may publish and nothing may be delivered.
        expect(deliveries).toHaveLength(0)
        expect((yield* jobs.wait({ id: owner, timeout: 250 })).info?.status).toBe("running")
        yield* Deferred.succeed(wakeRelease, undefined)
      }

      // PHASE 5 — the answer the caller actually receives.
      const settled = yield* jobs.wait({ id: owner, timeout: 10_000 })
      expect(settled.timedOut).toBe(false)
      expect(settled.info?.status).toBe("completed")
      yield* awaitWithTimeout(Deferred.await(parentDelivered), `${mode} owner never delivered its selected answer`)
      expect(deliveries).toHaveLength(1)
      // No second ingress: the wake turn is a turn in the CHILD's session through `ops.wake`, not
      // another attached delivery.
      expect(ingress).toHaveLength(1)

      if (mode === "clean") {
        expect(wake.begins).toEqual([false])
        expect(wake.provider).toBe(0)
        expect(wake.depth).toBe(0)
        expect(wake.peak).toBe(0)
        expect(wake.ends).toBe(0)
        expect(wake.exhausts).toBe(0)
        expect(scope.current().epoch).toBe(observation.epoch)
        expect(deliveries[0]).toContain("clean current-generation candidate")
        // The CANDIDATE was selected, not the retained fallback: `select` prefers a candidate over
        // the run-final the child yielded (`task-return.ts:186`).
        expect(deliveries[0]).not.toContain("wake clean owner fallback")
        expect(deliveries[0]).not.toContain(DEGRADED_WARNING)
      } else {
        expect(wake.begins).toEqual([true])
        expect(wake.provider).toBe(1)
        expect(wake.peak).toBe(1)
        expect(wake.depth).toBe(0)
        expect(wake.ends).toBe(1)
        expect(wake.exhausts).toBe(1)
        expect(deliveries[0]).toContain("wake no-evidence owner fallback")
        expect(deliveries[0]).toContain(DEGRADED_WARNING)
      }
    })

  // BOTH arms nest a grandchild inside the child, so both need the raised depth. At the default of
  // 1 the grandchild is refused before any attachment forms and the row would assert against a
  // topology it never built.
  it.instance(
    "a clean attached ingress installs the current-generation candidate and resolves without a wake",
    () => wakeEligibility("clean"),
    { config: { subagent_depth: 2 } },
  )

  it.instance(
    "an attached ingress with no evidence takes one real wake and degrades only once it is exhausted",
    () => wakeEligibility("no-evidence"),
    { config: { subagent_depth: 2 } },
  )

  const cancelledOwnerSuppresses = (descendant: "answer" | "cancelled") =>
    Effect.gen(function* () {
      const jobs = yield* BackgroundJob.Service
      const sessions = yield* Session.Service
      const coordinator = yield* AttachmentCoordinator.make
      const { chat, assistant } = yield* seed()
      const tool = yield* TaskTool
      const def = yield* tool.init()
      const resultEntered = yield* Deferred.make<void>()
      const firstResultDone = yield* Deferred.make<void>()
      const descendantStarted = yield* Deferred.make<void>()
      const descendantElected = yield* Deferred.make<void>()
      const descendantFinished = yield* Deferred.make<void>()
      const descendantRelease = yield* Deferred.make<void>()
      const ownerCancelled = yield* Deferred.make<void>()
      const owner: {
        scope?: AttachmentCoordinator.Scope
        earlier?: SessionV1.WithParts
      } = {}
      const IDs: { child?: SessionID; descendant?: SessionID } = {}
      const activity = { active: 0, wakes: 0 }
      const deliveriesIntoCancelledOwner: string[] = []
      let opens = 0

      const wrapOwner = (scope: AttachmentCoordinator.Scope) => {
        const instrumented: AttachmentCoordinator.Scope = {
          ...scope,
          claimObserver: (reservation) =>
            scope.claimObserver(reservation).pipe(
              Effect.tap((claim) =>
                Effect.gen(function* () {
                  if (claim.type !== "owner") return
                  activity.active++
                  yield* Deferred.succeed(descendantElected, undefined)
                }),
              ),
            ),
          claimCancellation: (status) =>
            scope.claimCancellation(status).pipe(Effect.tap(() => Deferred.succeed(ownerCancelled, undefined))),
          finishContinuation: () =>
            scope.finishContinuation().pipe(
              Effect.tap(() =>
                Effect.gen(function* () {
                  if (activity.active > 0) activity.active--
                  if (activity.active === 0) yield* Deferred.succeed(descendantFinished, undefined)
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
            if (owner.earlier) return scope.result(fallback)
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
        return instrumented
      }

      const attachments: AttachmentCoordinator.Interface = {
        ...coordinator,
        open: (sessionID) =>
          coordinator.open(sessionID).pipe(
            Effect.map((scope) => {
              opens++
              return opens === 1 ? wrapOwner(scope) : scope
            }),
          ),
        locate: (sessionID) =>
          coordinator
            .locate(sessionID)
            .pipe(Effect.map((scope) => (scope && owner.scope?.sessionID === sessionID ? owner.scope : scope))),
        locateBorrowable: (sessionID) =>
          coordinator
            .locateBorrowable(sessionID)
            .pipe(Effect.map((scope) => (scope && owner.scope?.sessionID === sessionID ? owner.scope : scope))),
      }

      const holder: { value?: TaskPromptOps } = {}
      const promptOps = basicOps({
        attachments,
        prompt: (input) =>
          Effect.gen(function* () {
            const text = promptText(input)
            if (text === "cancelled-owner-work") {
              IDs.child = input.sessionID
              if (!input.attachmentScope) return yield* Effect.die("cancelled owner had no attachment scope")
              yield* input.attachmentScope.own(input.messageID ?? MessageID.ascending())
              const anchor = yield* seedAssistant(input.sessionID, "general").pipe(
                Effect.provideService(Session.Service, sessions),
              )
              const nested = yield* def.execute(
                {
                  description: `descendant ${descendant}`,
                  prompt: "descendant-work",
                  subagent_type: "general",
                  async: true,
                },
                context({
                  sessionID: input.sessionID,
                  messageID: anchor.id,
                  promptOps: holder.value!,
                  attachment: input.attachmentScope,
                }),
              )
              IDs.descendant = nested.metadata.sessionId
              yield* Deferred.await(descendantElected)
              const response = reply(input, "cancelled owner yield")
              yield* input.attachmentScope.observeTurn({ assistant: response, clean: true })
              return response
            }
            if (text === "descendant-work") {
              yield* Deferred.succeed(descendantStarted, undefined)
              if (descendant === "cancelled") return yield* Effect.never
              yield* Deferred.await(descendantRelease)
              const response = reply(input, "descendant answer after owner cancellation")
              if (input.attachmentScope) {
                yield* input.attachmentScope.own(input.messageID ?? MessageID.ascending())
                yield* input.attachmentScope.observeTurn({ assistant: response, clean: true })
              }
              return response
            }
            if (IDs.child && input.sessionID === IDs.child) {
              deliveriesIntoCancelledOwner.push(text)
              return reply(input, "must not enter cancelled owner")
            }
            return reply(input, "unrelated delivery")
          }),
      })
      holder.value = promptOps

      const started = yield* def.execute(
        { description: "cancelled owner", prompt: "cancelled-owner-work", subagent_type: "general", async: true },
        context({ sessionID: chat.id, messageID: assistant.id, promptOps }),
      )
      yield* Deferred.await(descendantStarted)
      yield* Deferred.await(descendantElected)
      yield* Deferred.await(resultEntered)

      const child = IDs.child
      const nested = IDs.descendant
      const scope = owner.scope
      const earlier = owner.earlier
      if (!child || !nested || !scope || !earlier)
        return yield* Effect.die("descendant suppression topology incomplete")
      expect(child).toBe(started.metadata.sessionId)
      expect(scope.current()).toMatchObject({ attached: 1, everAttached: true, cancelled: false })
      expect(activity).toEqual({ active: 1, wakes: 0 })
      expect(yield* Deferred.isDone(firstResultDone)).toBe(false)

      const exact = yield* jobs.listExact()
      const childJob = exact.find((entry) => entry.info.id === child)
      const descendantJob = exact.find((entry) => entry.info.id === nested)
      if (!childJob || !descendantJob) return yield* Effect.die("missing exact descendant lifetimes")

      // Cancel only B's exact Task lifetime. C has already won observer election on B's owner scope
      // and remains independently live so the answer and cancelled-envelope variants can exercise
      // their real observer paths after B becomes cancelled.
      const childTerminal = yield* jobs.cancelExact(childJob.lifetime)
      expect(childTerminal?.status).toBe("cancelled")
      // `cancelExact` publishes the BackgroundJob terminal; B-3 projection runs on the distinct
      // lifetime-waiter fiber. Await that exact claim rather than assuming scheduler order.
      yield* Deferred.await(ownerCancelled)
      expect(scope.current().cancelled).toBe(true)
      expect(activity).toEqual({ active: 1, wakes: 0 })

      if (descendant === "answer") yield* Deferred.succeed(descendantRelease, undefined)
      if (descendant === "cancelled") yield* jobs.cancelExact(descendantJob.lifetime)
      const descendantTerminal = yield* jobs.waitExact({ lifetime: descendantJob.lifetime })
      expect(descendantTerminal.info?.status).toBe(descendant === "answer" ? "completed" : "cancelled")
      yield* Deferred.await(descendantFinished)

      // No poll or timeout stands in for suppression: the elected continuation itself settled and
      // drove active to zero. Only then may B's global cancellation resolution publish.
      expect(activity).toEqual({ active: 0, wakes: 0 })
      expect(deliveriesIntoCancelledOwner).toEqual([])
      const selected = yield* scope.result(earlier)
      expect(selected).toMatchObject({ type: "cancelled" })
      expect("fallback" in selected).toBe(false)
      expect(JSON.stringify(selected)).not.toContain("cancelled owner yield")
      expect(yield* Deferred.isDone(firstResultDone)).toBe(true)
    })

  it.instance(
    "an elected descendant answer never injects into its cancelled owner",
    () => cancelledOwnerSuppresses("answer"),
    { config: { subagent_depth: 2 } },
  )

  it.instance(
    "an elected descendant cancellation envelope never injects into its cancelled owner",
    () => cancelledOwnerSuppresses("cancelled"),
    { config: { subagent_depth: 2 } },
  )

  /**
   * R-08 — A SUPPLEMENT BORROWS THE OWNER'S PARKED SCOPE AND NEVER FINALIZES IT.
   *
   * `executeSupplement` resolves the child scope through `locateBorrowable` (`task.ts:539`), and a
   * live UNRESOLVED scope is borrowable. The borrow branch (`task.ts:540`) runs `attempt(located)`
   * bare — no `acquireUseRelease` — so the borrower passes through the SAME eligibility gate as the
   * owner and hands the scope back untouched. The self-open branch a few lines below is the ONLY one
   * that owns a finalizer (`task.ts:551-555`), and that asymmetry is the property under test.
   *
   * What the two parked waiters then receive is the rest of it. They resolve from one Deferred;
   * `complete()` reattaches the same first-latched fallback (`coordinator.ts:647,669`); and `select`
   * picks the same controlling Assistant for both (`task-return.ts:183-189`). So both
   * `Scope.result()` calls return the same selected identity, the answer log's filing guard makes
   * the second a no-op, and the parent receives ONE answer — not two, and not a stale one.
   */
  it.instance(
    "a supplement borrows the owner's parked scope, shares its one selected answer, and never finalizes it",
    () =>
      Effect.gen(function* () {
        const jobs = yield* BackgroundJob.Service
        const sessions = yield* Session.Service
        const coordinator = yield* AttachmentCoordinator.make
        const { chat, assistant } = yield* seed()
        const tool = yield* TaskTool
        const def = yield* tool.init()

        const gate = yield* gates
        const descendantStarted = yield* gate
        const descendantRelease = yield* gate
        const ownerParked = yield* gate
        const supplementParked = yield* gate
        const ingressStarted = yield* gate
        const parentDelivered = yield* gate
        const ownerClosed = yield* gate

        const owner: { id?: SessionID; scope?: AttachmentCoordinator.Scope } = {}
        const holder: { value?: TaskPromptOps } = {}
        const openedFor: SessionID[] = []
        const borrowed: Array<string | undefined> = []
        const entered: MessageID[] = []
        const selections: TaskSelectedReturn[] = []
        const owns: boolean[] = []
        const ingress: string[] = []
        const deliveries: string[] = []
        const finalize = { closes: 0, degrades: 0, cancels: 0 }

        const wrap = (scope: AttachmentCoordinator.Scope): AttachmentCoordinator.Scope => {
          const instrumented: AttachmentCoordinator.Scope = {
            ...scope,
            // Forked so the moment a waiter ENTERS the gate is observable, not only the moment it
            // leaves. The borrow must be enrolled before the resolution publishes; if it arrived
            // after, Admission Freshness would correctly hand it a fresh answer instead of the
            // shared one, and this row would be testing the wrong branch. Same fork/yield/join
            // shape the cancelled-owner row above uses.
            result: (fallback) =>
              Effect.gen(function* () {
                const pending = yield* scope.result(fallback).pipe(Effect.forkChild)
                yield* Effect.yieldNow
                entered.push(fallback.info.id)
                if (entered.length === 1) yield* Deferred.succeed(ownerParked, undefined)
                if (entered.length === 2) yield* Deferred.succeed(supplementParked, undefined)
                const selected = yield* Fiber.join(pending)
                selections.push(selected)
                return selected
              }),
            // `finalizeScope` reaches a scope only through these three (`coordinator.ts:119-124`),
            // and it ALWAYS closes — so `closes` counts every finalization of this exact
            // generation, whichever site performed it.
            close: () =>
              Effect.suspend(() => {
                finalize.closes++
                return scope.close().pipe(Effect.tap(() => Deferred.succeed(ownerClosed, undefined)))
              }),
            degrade: () =>
              Effect.suspend(() => {
                finalize.degrades++
                return scope.degrade()
              }),
            claimCancellation: (status) =>
              Effect.suspend(() => {
                finalize.cancels++
                return scope.claimCancellation(status)
              }),
          }
          owner.scope = instrumented
          return instrumented
        }

        const wrapperFor = (scope: AttachmentCoordinator.Scope | undefined) =>
          scope && owner.scope?.id === scope.id ? owner.scope : scope
        const attachments: AttachmentCoordinator.Interface = {
          ...coordinator,
          open: (sessionID) =>
            coordinator.open(sessionID).pipe(
              Effect.map((scope) => {
                openedFor.push(sessionID)
                return openedFor.length === 1 ? wrap(scope) : scope
              }),
            ),
          locate: (sessionID) => coordinator.locate(sessionID).pipe(Effect.map(wrapperFor)),
          // `executeSupplement` is the ONLY consumer (`task.ts:539`), so this records exactly what
          // each supplement was offered to borrow.
          locateBorrowable: (sessionID) =>
            coordinator.locateBorrowable(sessionID).pipe(
              Effect.map(wrapperFor),
              Effect.tap((scope) => Effect.sync(() => borrowed.push(scope?.id))),
            ),
        }

        const promptOps = basicOps({
          attachments,
          prompt: (input) =>
            Effect.gen(function* () {
              const text = promptText(input)
              if (text === "borrow-owner-work") {
                owner.id = input.sessionID
                if (!input.attachmentScope) return yield* Effect.die("the borrow owner ran without a scope")
                const anchor = yield* seedAssistant(input.sessionID, "general").pipe(
                  Effect.provideService(Session.Service, sessions),
                )
                yield* def.execute(
                  {
                    description: "borrow descendant",
                    prompt: "borrow-descendant-work",
                    subagent_type: "general",
                    async: true,
                  },
                  context({
                    sessionID: input.sessionID,
                    messageID: anchor.id,
                    promptOps: holder.value!,
                    attachment: input.attachmentScope,
                  }),
                )
                yield* Deferred.succeed(descendantStarted, undefined)
                // Returns rather than parking here: the OWNER has to reach `Scope.result()` and
                // park THERE, because a scope parked at its gate is what the supplement borrows.
                return reply(input, "borrow owner run-final")
              }
              if (text === "borrow-descendant-work") {
                yield* Deferred.await(descendantRelease)
                return reply(input, "borrow descendant answer")
              }
              if (text === "borrow-supplement-work") {
                if (!input.attachmentScope) return yield* Effect.die("the supplement ran without a borrowed scope")
                // Production's prompt claims its message on the scope it was handed; a live
                // unresolved scope admits it (`coordinator.ts:411-418`). Recorded rather than
                // asserted here — an `expect` throwing inside a production fiber becomes a defect
                // that reports somewhere far from its cause.
                owns.push(yield* input.attachmentScope.own(input.messageID ?? MessageID.ascending()))
                return reply(input, "borrow supplement run-final")
              }
              if (owner.id && input.sessionID === owner.id) {
                ingress.push(text)
                const response = reply(input, "borrow ingress candidate")
                if (input.attachmentScope) {
                  yield* input.attachmentScope.observeTurn({ assistant: response, clean: true })
                }
                yield* Deferred.succeed(ingressStarted, undefined)
                return response
              }
              if (input.sessionID === chat.id) {
                deliveries.push(text)
                yield* Deferred.succeed(parentDelivered, undefined)
                return reply(input, "parent accepted the borrowed answer")
              }
              return reply(input, "unrelated delivery")
            }),
        })
        holder.value = promptOps

        const started = yield* def.execute(
          { description: "borrow owner", prompt: "borrow-owner-work", subagent_type: "general", async: true },
          context({ sessionID: chat.id, messageID: assistant.id, promptOps }),
        )
        const child = started.metadata.sessionId
        yield* awaitWithTimeout(Deferred.await(descendantStarted), "the borrow owner never launched its descendant")
        yield* awaitWithTimeout(Deferred.await(ownerParked), "the borrow owner never parked at its eligibility gate")

        const scope = owner.scope
        if (!scope || owner.id !== child) {
          return yield* Effect.die("the borrow topology did not capture the owner scope")
        }
        expect(openedFor.filter((one) => one === child)).toHaveLength(1)
        expect(scope.current()).toMatchObject({ attached: 1, everAttached: true, failed: false, cancelled: false })
        expect(finalize).toEqual({ closes: 0, degrades: 0, cancels: 0 })
        expect(entered).toHaveLength(1)
        // Live and UNRESOLVED, so borrowable — the exact state R-08 qualifies on.
        expect((yield* coordinator.locateBorrowable(child))?.id).toBe(scope.id)

        const receipt = yield* def.execute(
          {
            description: "borrow supplement",
            prompt: "borrow-supplement-work",
            subagent_type: "general",
            task_id: child,
          },
          context({ sessionID: chat.id, messageID: assistant.id, promptOps }),
        )
        expect(receipt.metadata.sessionId).toBe(child)
        yield* awaitWithTimeout(
          Deferred.await(supplementParked),
          "the supplement never reached the shared eligibility gate",
        )

        // THE BORROW. It took the SAME generation, opened nothing of its own, was admitted onto the
        // scope, and the descendant's work is still live underneath both waiters.
        expect(borrowed).toEqual([scope.id])
        expect(owns).toEqual([true])
        expect(openedFor.filter((one) => one === child)).toHaveLength(1)
        expect(finalize).toEqual({ closes: 0, degrades: 0, cancels: 0 })
        expect(scope.current()).toMatchObject({ attached: 1, cancelled: false, failed: false })
        expect(deliveries).toHaveLength(0)

        // The descendant settles, its result enters the shared scope, and ONE resolution publishes
        // for both waiters.
        yield* Deferred.succeed(descendantRelease, undefined)
        yield* awaitWithTimeout(Deferred.await(ingressStarted), "the descendant result never entered the shared scope")
        const settled = yield* jobs.wait({ id: child, timeout: 10_000 })
        expect(settled.timedOut).toBe(false)
        expect(settled.info?.status).toBe("completed")
        yield* awaitWithTimeout(Deferred.await(parentDelivered), "the borrowed answer never reached the parent")
        yield* awaitWithTimeout(Deferred.await(ownerClosed), "the owner scope was never finalized")

        // ONE SELECTED IDENTITY, TWO WAITERS.
        expect(entered).toHaveLength(2)
        expect(selections).toHaveLength(2)
        const [first, second] = selections
        if (!first || !second) return yield* Effect.die("both waiters did not return a selected result")
        expect(first).toMatchObject({ type: "evidence", degraded: false })
        expect(second).toMatchObject({ type: "evidence", degraded: false })
        expect(controllingAssistant(first)?.info.id).toBe(controllingAssistant(second)?.info.id)
        expect(first).toEqual(second)

        // ...and it was filed and delivered ONCE, as the candidate rather than either run-final.
        expect(ingress).toHaveLength(1)
        expect(deliveries).toHaveLength(1)
        expect(deliveries[0]).toContain("borrow ingress candidate")
        expect(deliveries[0]).not.toContain(DEGRADED_WARNING)
        expect(deliveries[0]).not.toContain("borrow supplement run-final")
        expect(deliveries[0]).not.toContain("borrow owner run-final")

        // THE BORROWER NEVER FINALIZED. Exactly one close, and it is the owner's own lifetime
        // terminal; wrapping the borrow branch in `acquireUseRelease` would make this two.
        expect(finalize).toEqual({ closes: 1, degrades: 0, cancels: 0 })
        expect(yield* coordinator.locate(child)).toBeUndefined()
      }),
    { config: { subagent_depth: 2 } },
  )

  /**
   * R-08 — THE PUBLISHED-RESOLUTION REPLACEMENT HELD WINDOW, WITH A REAL DESCENDANT.
   *
   * THE WINDOW. A scope that has published its resolution stays REGISTERED until its finalizer
   * unregisters it. Here the child's run is still parked in `ops.prompt` when its grandchild's
   * result arrives, so the gate publishes (`coordinator.ts:340-345`) while the run — and therefore
   * the lifetime terminal that would finalize the scope — has not happened yet. That leaves the
   * predecessor registered AND resolved, which is precisely the interval R-08 names: raw `locate`
   * still answers with it as registry truth, while `locateBorrowable` refuses it
   * (`coordinator.ts:773-780`).
   *
   * WHY THIS SHAPE AND NOT A TERMINAL ONE. A genuinely terminal prior lifetime is NOT this fixture:
   * post-terminal `Task(task_id)` takes the owner/replacement-start route and opens a scope at
   * `task.ts:1039` before `startExact`, never reaching `executeSupplement` at all. Only a LIVE
   * lifetime whose scope has already resolved routes a supplement into the self-open branch.
   *
   * WHAT THE SUPPLEMENT THEN DOES. Borrowing refused, it opens (`task.ts:541`), and `open`
   * atomically replaces the resolved incumbent in one synchronous critical section
   * (`coordinator.ts:717-729`). The successor owns a REAL descendant and parks through eligibility,
   * so the direct finalizer at `task.ts:554` — the one outside `ownerScopeHolder`'s dedupe — cannot
   * run until that descendant is quiescent and the answer is eligible.
   *
   * AND WHAT THE PREDECESSOR CANNOT DO. Its finalizer runs later and must not evict the successor:
   * `closeNow` deletes only while the registered scope id is still its own (`coordinator.ts:349`),
   * and each open mints a fresh id. That is asserted by invoking the predecessor's own production
   * finalizer at the exact instant the race makes hazardous — while the successor is registered and
   * parked — rather than waiting on lifetime-terminal scheduling, which cannot be pinned.
   *
   * Finally, releasing the held child proves the two answers stay DISTINCT. The child's run-final is
   * not in the predecessor's frozen `publishedMembers`, so Admission Freshness returns it fresh
   * (`coordinator.ts:636-641`) instead of replaying the earlier position.
   */
  it.instance(
    "a supplement replaces a published-resolution incumbent, holds its own descendant, and files a distinct answer",
    () =>
      Effect.gen(function* () {
        const jobs = yield* BackgroundJob.Service
        const sessions = yield* Session.Service
        const coordinator = yield* AttachmentCoordinator.make
        const { chat, assistant } = yield* seed()
        const tool = yield* TaskTool
        const def = yield* tool.init()

        const gate = yield* gates
        const firstDescendantStarted = yield* gate
        const firstDescendantRelease = yield* gate
        const firstPublished = yield* gate
        const firstParked = yield* gate
        const firstClosed = yield* gate
        const secondDescendantStarted = yield* gate
        const secondDescendantRelease = yield* gate
        const secondPublished = yield* gate
        const secondParked = yield* gate
        const secondClosed = yield* gate
        const ownerRelease = yield* gate
        const firstDelivered = yield* gate
        const secondDelivered = yield* gate

        const owner: { id?: SessionID } = {}
        const holder: { value?: TaskPromptOps } = {}
        const generations: AttachmentCoordinator.Scope[] = []
        const openedFor: SessionID[] = []
        const borrowed: Array<string | undefined> = []
        const closes: string[] = []
        const selections: Array<{ scope: string; selected: TaskSelectedReturn }> = []
        const ingress: string[] = []
        const deliveries: string[] = []

        const wrap = (
          scope: AttachmentCoordinator.Scope,
          published: Deferred.Deferred<void>,
          parked: Deferred.Deferred<void>,
          closed: Deferred.Deferred<void>,
        ): AttachmentCoordinator.Scope => {
          const instrumented: AttachmentCoordinator.Scope = {
            ...scope,
            // The observer's `ensuring` (`task.ts:810`) is the last thing to drop `active` to zero,
            // and `apply` runs `gate()` AFTER the body — so this effect completing is the exact,
            // poll-free instant at which this generation has published if it ever will.
            finishContinuation: () =>
              scope.finishContinuation().pipe(Effect.tap(() => Deferred.succeed(published, undefined))),
            result: (fallback) =>
              Effect.gen(function* () {
                const pending = yield* scope.result(fallback).pipe(Effect.forkChild)
                yield* Effect.yieldNow
                yield* Deferred.succeed(parked, undefined)
                const selected = yield* Fiber.join(pending)
                selections.push({ scope: scope.id, selected })
                return selected
              }),
            close: () =>
              Effect.suspend(() => {
                closes.push(scope.id)
                return scope.close().pipe(Effect.tap(() => Deferred.succeed(closed, undefined)))
              }),
          }
          generations.push(instrumented)
          return instrumented
        }

        const wrapperFor = (scope: AttachmentCoordinator.Scope | undefined) =>
          scope ? (generations.find((one) => one.id === scope.id) ?? scope) : scope
        const attachments: AttachmentCoordinator.Interface = {
          ...coordinator,
          open: (sessionID) =>
            coordinator.open(sessionID).pipe(
              Effect.map((scope) => {
                openedFor.push(sessionID)
                // The child's own open is the first (`task.ts:1039` precedes its run), which is what
                // identifies the session whose generations this row follows. Grandchildren open
                // their own scopes for their own sessions and are left raw.
                if (!owner.id) owner.id = sessionID
                if (sessionID !== owner.id) return scope
                return generations.length === 0
                  ? wrap(scope, firstPublished, firstParked, firstClosed)
                  : wrap(scope, secondPublished, secondParked, secondClosed)
              }),
            ),
          locate: (sessionID) => coordinator.locate(sessionID).pipe(Effect.map(wrapperFor)),
          locateBorrowable: (sessionID) =>
            coordinator.locateBorrowable(sessionID).pipe(
              Effect.map(wrapperFor),
              Effect.tap((scope) => Effect.sync(() => borrowed.push(scope?.id))),
            ),
        }

        const promptOps = basicOps({
          attachments,
          prompt: (input) =>
            Effect.gen(function* () {
              const text = promptText(input)
              if (text === "rotate-owner-work") {
                if (!input.attachmentScope) return yield* Effect.die("the rotate owner ran without a scope")
                const anchor = yield* seedAssistant(input.sessionID, "general").pipe(
                  Effect.provideService(Session.Service, sessions),
                )
                yield* def.execute(
                  { description: "rotate g1", prompt: "rotate-g1-work", subagent_type: "general", async: true },
                  context({
                    sessionID: input.sessionID,
                    messageID: anchor.id,
                    promptOps: holder.value!,
                    attachment: input.attachmentScope,
                  }),
                )
                yield* Deferred.succeed(firstDescendantStarted, undefined)
                // HELD HERE, inside the run. This is what keeps the lifetime non-terminal — and so
                // the predecessor registered — while its scope publishes underneath it.
                yield* Deferred.await(ownerRelease)
                return reply(input, "rotate owner run-final")
              }
              if (text === "rotate-g1-work") {
                yield* Deferred.await(firstDescendantRelease)
                return reply(input, "rotate g1 descendant answer")
              }
              if (text === "rotate-supplement-work") {
                if (!input.attachmentScope) return yield* Effect.die("the rotate supplement ran without a scope")
                const anchor = yield* seedAssistant(input.sessionID, "general").pipe(
                  Effect.provideService(Session.Service, sessions),
                )
                yield* def.execute(
                  { description: "rotate g2", prompt: "rotate-g2-work", subagent_type: "general", async: true },
                  context({
                    sessionID: input.sessionID,
                    messageID: anchor.id,
                    promptOps: holder.value!,
                    attachment: input.attachmentScope,
                  }),
                )
                yield* Deferred.succeed(secondDescendantStarted, undefined)
                return reply(input, "rotate supplement run-final")
              }
              if (text === "rotate-g2-work") {
                yield* Deferred.await(secondDescendantRelease)
                return reply(input, "rotate g2 descendant answer")
              }
              if (owner.id && input.sessionID === owner.id) {
                ingress.push(text)
                const which = text.includes("g1") ? "first" : "second"
                const response = reply(input, `rotate ${which} ingress candidate`)
                if (input.attachmentScope) {
                  yield* input.attachmentScope.observeTurn({ assistant: response, clean: true })
                }
                return response
              }
              if (input.sessionID === chat.id) {
                deliveries.push(text)
                yield* Deferred.succeed(deliveries.length === 1 ? firstDelivered : secondDelivered, undefined)
                return reply(input, "parent accepted a rotated answer")
              }
              return reply(input, "unrelated delivery")
            }),
        })
        holder.value = promptOps

        const started = yield* def.execute(
          { description: "rotate owner", prompt: "rotate-owner-work", subagent_type: "general", async: true },
          context({ sessionID: chat.id, messageID: assistant.id, promptOps }),
        )
        const child = started.metadata.sessionId
        yield* awaitWithTimeout(Deferred.await(firstDescendantStarted), "the rotate owner never launched g1")

        // PHASE 1 — the grandchild settles into the still-parked child, and the predecessor
        // publishes while its run is held.
        yield* Deferred.succeed(firstDescendantRelease, undefined)
        yield* awaitWithTimeout(Deferred.await(firstPublished), "the predecessor never settled its grandchild")
        const first = generations[0]
        if (!first || owner.id !== child) return yield* Effect.die("the rotate topology did not capture generation 1")
        // An ingress carries the grandchild's RENDERED envelope, so the identifying answer text is
        // matched inside it rather than against it.
        expect(ingress).toHaveLength(1)
        expect(ingress[0]).toContain("rotate g1 descendant answer")

        // THE R-08 WINDOW: registry truth still answers, borrowing refuses, nothing has filed.
        expect((yield* coordinator.locate(child))?.id).toBe(first.id)
        expect(yield* coordinator.locateBorrowable(child)).toBeUndefined()
        expect(closes).toEqual([])
        expect(deliveries).toHaveLength(0)
        expect((yield* jobs.wait({ id: child, timeout: 250 })).info?.status).toBe("running")

        // PHASE 2 — the supplement is refused the borrow, opens, and atomically replaces.
        const receipt = yield* def.execute(
          {
            description: "rotate supplement",
            prompt: "rotate-supplement-work",
            subagent_type: "general",
            task_id: child,
          },
          context({ sessionID: chat.id, messageID: assistant.id, promptOps }),
        )
        expect(receipt.metadata.sessionId).toBe(child)
        yield* awaitWithTimeout(Deferred.await(secondDescendantStarted), "the rotate supplement never launched g2")
        yield* awaitWithTimeout(Deferred.await(secondParked), "the successor never parked at its eligibility gate")

        const second = generations[1]
        if (!second) return yield* Effect.die("the supplement never opened a successor generation")
        expect(borrowed).toEqual([undefined])
        expect(openedFor.filter((one) => one === child)).toHaveLength(2)
        expect(second.id).not.toBe(first.id)
        expect((yield* coordinator.locate(child))?.id).toBe(second.id)
        // The successor owns REAL descendant work and is parked behind it, so the direct finalizer
        // cannot have run.
        expect(second.current()).toMatchObject({ attached: 1, everAttached: true, failed: false, cancelled: false })
        expect(closes).toEqual([])
        expect(deliveries).toHaveLength(0)

        // PHASE 3 — the predecessor's own production finalizer, invoked at the exact instant the
        // race makes hazardous. It must not evict the successor.
        yield* AttachmentCoordinator.finalizeScope(first, Exit.void)
        expect(closes).toEqual([first.id])
        expect((yield* coordinator.locate(child))?.id).toBe(second.id)
        expect(second.current()).toMatchObject({ attached: 1, failed: false, cancelled: false })

        // PHASE 4 — the successor's descendant quiesces, its answer becomes eligible, and ONLY THEN
        // does the direct finalizer at `task.ts:554` run — exactly once.
        yield* Deferred.succeed(secondDescendantRelease, undefined)
        yield* awaitWithTimeout(Deferred.await(secondPublished), "the successor never settled its grandchild")
        yield* awaitWithTimeout(Deferred.await(firstDelivered), "the successor's answer never reached the parent")
        yield* awaitWithTimeout(Deferred.await(secondClosed), "the direct finalizer never released the successor")
        expect(closes.filter((one) => one === second.id)).toHaveLength(1)
        expect(ingress).toHaveLength(2)
        expect(ingress[1]).toContain("rotate g2 descendant answer")
        expect(deliveries).toHaveLength(1)
        expect(deliveries[0]).toContain("rotate second ingress candidate")
        expect(deliveries[0]).not.toContain(DEGRADED_WARNING)

        // PHASE 5 — releasing the held child yields a SECOND, DISTINCT answer. Its run-final is
        // outside the predecessor's frozen membership, so it returns fresh rather than replaying
        // the position the first answer already holds.
        yield* Deferred.succeed(ownerRelease, undefined)
        yield* awaitWithTimeout(Deferred.await(secondDelivered), "the released child's own answer never arrived")
        const settled = yield* jobs.wait({ id: child, timeout: 10_000 })
        expect(settled.timedOut).toBe(false)
        expect(settled.info?.status).toBe("completed")

        expect(deliveries).toHaveLength(2)
        expect(deliveries[1]).toContain("rotate owner run-final")
        expect(deliveries[1]).not.toContain(DEGRADED_WARNING)
        expect(deliveries[0]).not.toEqual(deliveries[1])

        // Two selected records, one per generation, neither degraded and each speaking for its own
        // controlling Assistant.
        expect(selections).toHaveLength(2)
        const successor = selections.find((one) => one.scope === second.id)
        const predecessor = selections.find((one) => one.scope === first.id)
        if (!successor || !predecessor) return yield* Effect.die("each generation did not return a selected result")
        expect(successor.selected).toMatchObject({ type: "evidence", degraded: false })
        expect(predecessor.selected).toMatchObject({ type: "evidence", degraded: false })
        expect(controllingAssistant(successor.selected)?.info.id).not.toBe(
          controllingAssistant(predecessor.selected)?.info.id,
        )
      }),
    { config: { subagent_depth: 2 } },
  )

  /**
   * R-08 — THE FEATURE-OFF CONTROL: NO SCOPE IS OPENED, AND THE TURN IS IMMEDIATELY ELIGIBLE.
   *
   * `executeSupplement` returns `attempt()` with NO invocation before it touches the coordinator at
   * all (`task.ts:530`), and `eligible(undefined, result)` then treats the run-final Assistant as
   * the answer outright (`task.ts:387-389`) because there is no coordinator to disagree with. This
   * row is the negative that keeps the two scoped rows above honest: same supplemental path, same
   * fixture shape, no scope anywhere.
   *
   * IT RUNS ON `itOff`. RuntimeFlags are compiled into the layer, so a per-test `config` option
   * cannot reach them — hence the second compiled layer and second `testEffect` instance at the top
   * of this file rather than an option on this test.
   *
   * The owner here is SYNCHRONOUS because it has to be: with the flag off `async: true` is refused
   * outright (`task.ts:160-162`). Forking the blocking call and parking its run is therefore the
   * only way to hold a live lifetime open for a supplement to join.
   */
  itOff.instance("with the feature off a supplement opens no scope and its run-final is immediately eligible", () =>
    Effect.gen(function* () {
      const jobs = yield* BackgroundJob.Service
      const coordinator = yield* AttachmentCoordinator.make
      const { chat, assistant } = yield* seed()
      const tool = yield* TaskTool
      const def = yield* tool.init()

      const gate = yield* gates
      const ownerStarted = yield* gate
      const ownerRelease = yield* gate
      const supplementRan = yield* gate

      const owner: { id?: SessionID } = {}
      const openedFor: SessionID[] = []
      const supplement = { runs: 0, scoped: [] as boolean[] }

      const attachments: AttachmentCoordinator.Interface = {
        ...coordinator,
        open: (sessionID) =>
          Effect.suspend(() => {
            openedFor.push(sessionID)
            return coordinator.open(sessionID)
          }),
      }

      const promptOps = basicOps({
        attachments,
        prompt: (input) =>
          Effect.gen(function* () {
            const text = promptText(input)
            if (text === "flag-off-owner-work") {
              owner.id = input.sessionID
              yield* Deferred.succeed(ownerStarted, undefined)
              yield* Deferred.await(ownerRelease)
              return reply(input, "flag-off owner answer")
            }
            if (text === "flag-off-supplement-work") {
              supplement.runs++
              supplement.scoped.push(input.attachmentScope !== undefined)
              yield* Deferred.succeed(supplementRan, undefined)
              return reply(input, "flag-off supplement answer")
            }
            return reply(input, "unrelated delivery")
          }),
      })

      const ownerCall = yield* def
        .execute(
          { description: "flag-off owner", prompt: "flag-off-owner-work", subagent_type: "general" },
          context({ sessionID: chat.id, messageID: assistant.id, promptOps }),
        )
        .pipe(Effect.forkChild)
      yield* awaitWithTimeout(Deferred.await(ownerStarted), "the flag-off owner never started")
      const child = owner.id
      if (!child) return yield* Effect.die("the flag-off owner never reported its session")

      // Nothing exists to be found, borrowed, or finalized: `task.ts:1039-1041` opens a scope only
      // with the flag on.
      expect(openedFor).toEqual([])
      expect(yield* coordinator.locate(child)).toBeUndefined()

      const receipt = yield* def.execute(
        {
          description: "flag-off supplement",
          prompt: "flag-off-supplement-work",
          subagent_type: "general",
          task_id: child,
        },
        context({ sessionID: chat.id, messageID: assistant.id, promptOps }),
      )
      yield* awaitWithTimeout(Deferred.await(supplementRan), "the flag-off supplement never ran")

      // It reached its run SCOPE-LESS, which is the branch taken before any coordinator call.
      expect(supplement.runs).toBe(1)
      expect(supplement.scoped).toEqual([false])
      expect(openedFor).toEqual([])
      expect(yield* coordinator.locate(child)).toBeUndefined()
      // A truthful receipt for a live foreground lifetime: running, and this task.
      expect(receipt.output).toContain(`<task id="${child}" state="running">`)
      expect(receipt.metadata.sessionId).toBe(child)

      // Releasing the owner lets the blocked call render and return.
      yield* Deferred.succeed(ownerRelease, undefined)
      const result = yield* awaitWithTimeout(Fiber.join(ownerCall), "the flag-off owner never returned", "10 seconds")
      expect(result.output).toContain(`<task id="${child}" state="completed">`)

      // WHICH answer the single synchronous slot carries is ORDERING, not eligibility. This row
      // holds the owner deliberately, so the supplement's turn was eligible and filed first and is
      // therefore first in conversation order — which is what `task.ts:1230-1231` reads. The
      // caller is told so rather than left to infer it: the standing notice discloses that a
      // supplemental prompt was registered and that its outcome is addressable by `task_id`.
      // Preserved CP-032 B-4/B-5/B-6 behaviour, asserted here rather than worked around.
      expect(result.output).toContain("flag-off supplement answer")
      expect(result.output).toContain("A supplemental prompt was still registered when this answer completed.")

      // NONVACUITY, and the real eligibility oracle. BOTH scope-less turns had to reach settlement
      // for this lifetime to terminalize at all; a turn parked on a resolution that can never
      // arrive would leave it running and the join above would never have returned. With no scope
      // in existence there is nothing either turn could have parked on, which is exactly the
      // claim: `eligible(undefined, result)` returns the run-final immediately.
      const settled = yield* jobs.wait({ id: child, timeout: 10_000 })
      expect(settled.timedOut).toBe(false)
      expect(settled.info?.status).toBe("completed")
      expect(openedFor).toEqual([])
    }),
  )
})
