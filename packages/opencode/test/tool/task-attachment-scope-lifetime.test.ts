import { afterEach, describe, expect } from "bun:test"
import { Deferred, Effect, Layer } from "effect"
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
 * delivery step is `inject(...)`, a prompt into the PARENT, and a prompt into a running session
 * joins that run and returns only when the run ENDS (`prompt` reaches
 * `SessionRunState.ensureRunning`, which awaits the active run's `done`). A finished child
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

/**
 * A persisted user+assistant pair in an EXISTING session. Task resolves `ctx.messageID` against
 * durable storage, so a freshly minted id fails with "Message not found" — which is what a nested
 * Task launched from inside a child's run needs this for.
 */
const seedAssistant = Effect.fn("TaskScopeLifetimeTest.seedAssistant")(function* (
  sessionID: SessionID,
  agent: string,
) {
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
    prompt: (input) =>
      (input.onAdmitted ?? Effect.void).pipe(Effect.andThen(Effect.suspend(() => ops.prompt(input)))),
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
  it.instance("a grandchild attached to the child still delivers after the child's scope is finalized", () =>
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
      yield* awaitWithTimeout(Deferred.await(grandchildStarted), "the child never launched a grandchild", "10 seconds")
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

      // The child's run ends while the grandchild is still running.
      yield* Deferred.succeed(childRelease, undefined)
      expect((yield* jobs.wait({ id: child, timeout: 5_000 })).info?.status).toBe("completed")

      // The child's observer delivers into the (unparked) top-level parent and finishes, so the
      // child's scope is finalized on the ordinary path.
      yield* pollWithTimeout(
        Effect.gen(function* () {
          return (yield* coordinator.locate(child)) === undefined ? true : undefined
        }),
        "the child's owner scope never finalized",
        "10 seconds",
      )

      // Now the grandchild finishes and its observer tries to reach back through the closed scope.
      yield* Deferred.succeed(grandchildRelease, undefined)
      const grandchild = grandchildID.value!
      expect((yield* jobs.wait({ id: grandchild, timeout: 5_000 })).info?.status).toBe("completed")

      // Settle: give the grandchild's observer room to run to completion before reading the result.
      for (let attempt = 0; attempt < 2000 && !deliveries.some((d) => d.sessionID === child); attempt++) {
        yield* Effect.yieldNow
      }

      // THE FINDING — and it is the opposite of what the source reading predicted.
      //
      // The grandchild's result STILL REACHES THE CHILD. Closing the child's scope does not strand
      // it: `closeNow` marks the scope degraded, and the attached observer reads that and falls
      // back to `deliverRetained(handle, undefined)` — the ORDINARY parent ingress, with no
      // attachment scope. The delivery is downgraded, not lost.
      //
      // What the closed scope costs is the attachment DANCE, not the content: no terminal marker,
      // no candidate/observed selection, no wake. The arriving text is the same rendered terminal.
      const intoChild = deliveries.filter((entry) => entry.sessionID === child)
      const intoParent = deliveries.filter((entry) => entry.sessionID === chat.id)
      expect(intoParent.length).toBeGreaterThanOrEqual(1)
      expect(intoChild).toHaveLength(1)
      expect(intoChild[0]?.text).toContain("grandchild done")
      // Delivered through the degraded/ordinary route rather than the attached one.
      expect(intoChild[0]?.attached).toBe(false)
    }),
    // This case is about what happens to an attached grandchild's delivery, so the nesting it
    // exercises has to be permitted: at the default depth of 1 the grandchild is refused before any
    // attachment forms, and the test would pass on a scenario it never built.
    { config: { subagent_depth: 2 } },
  )
})
