import { afterEach, describe, expect } from "bun:test"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { Database } from "@opencode-ai/core/database/database"
import { Cause, Deferred, Effect, Exit, Fiber, Layer } from "effect"
import { Agent } from "@/agent/agent"
import { BackgroundJob } from "@/background/job"
import { EventV2Bridge } from "@/event-v2-bridge"
import { Config } from "@/config/config"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Ripgrep } from "@opencode-ai/core/ripgrep"
import { Session } from "@/session/session"
import type { SessionPrompt } from "@/session/prompt"
import { MessageID, PartID, SessionID } from "@/session/schema"
import { SessionRunState } from "@/session/run-state"
import { SessionStatus } from "@/session/status"
import { SubagentLimits } from "@/session/subagent-limits"
import { TaskTool, type TaskPromptOps } from "@/tool/task"
import { Truncate } from "@/tool/truncate"
import { ToolRegistry } from "@/tool/registry"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { disposeAllInstances } from "../fixture/fixture"
import { awaitWithTimeout, testEffect } from "../lib/effect"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ModelV2 } from "@opencode-ai/core/model"

// Phase-2 Issue 1: fail-fast breadth cap on the subagents a SINGLE session may
// have RUNNING concurrently as its direct children (design-final §10 variant
// (b)). The cap is keyed by the SPAWNING session, NOT the tree root — the
// design note proves a tree-wide semaphore over foreground chains deadlocks
// (two parallel L2 foreground parents each hold a permit and wait on an L3
// child that can never get one). These tests drive TaskTool.execute directly
// with controllable promptOps so children can be held running deterministically.

afterEach(async () => {
  await disposeAllInstances()
})

const ref = {
  providerID: ProviderV2.ID.make("test"),
  modelID: ModelV2.ID.make("test-model"),
}

const layer = (flags: Partial<RuntimeFlags.Info> = {}) =>
  Layer.mergeAll(
    Agent.defaultLayer,
    BackgroundJob.defaultLayer,
    EventV2Bridge.defaultLayer,
    Config.defaultLayer,
    CrossSpawnSpawner.defaultLayer,
    Session.defaultLayer,
    SessionRunState.defaultLayer,
    SessionStatus.defaultLayer,
    Truncate.defaultLayer,
    ToolRegistry.defaultLayer,
    Database.defaultLayer,
    RuntimeFlags.layer(flags),
  ).pipe(Layer.provide(Ripgrep.defaultLayer))

const it = testEffect(layer())

function defer<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

const seedMessages = Effect.fn("NestedConcurrencyTest.seedMessages")(function* (sessionID: SessionID) {
  const session = yield* Session.Service
  const user = yield* session.updateMessage({
    id: MessageID.ascending(),
    role: "user",
    sessionID,
    agent: "build",
    model: ref,
    time: { created: Date.now() },
  })
  const assistant: SessionV1.Assistant = {
    id: MessageID.ascending(),
    role: "assistant",
    parentID: user.id,
    sessionID,
    mode: "build",
    agent: "build",
    cost: 0,
    path: { cwd: "/tmp", root: "/tmp" },
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    modelID: ref.modelID,
    providerID: ref.providerID,
    variant: "xhigh",
    time: { created: Date.now() },
  }
  yield* session.updateMessage(assistant)
  return assistant
})

const seed = Effect.fn("NestedConcurrencyTest.seed")(function* (title = "CEO") {
  const session = yield* Session.Service
  const chat = yield* session.create({ title })
  const assistant = yield* seedMessages(chat.id)
  return { chat, assistant }
})

const taskParams = {
  description: "delegate work",
  prompt: "do the share",
  subagent_type: "general",
}

function taskCtx(input: {
  sessionID: SessionID
  messageID: MessageID
  promptOps: TaskPromptOps
  abort?: AbortSignal
  extra?: Record<string, unknown>
}) {
  return {
    sessionID: input.sessionID,
    messageID: input.messageID,
    agent: "build",
    abort: input.abort ?? new AbortController().signal,
    extra: { promptOps: input.promptOps, ...input.extra },
    messages: [],
    metadata: () => Effect.void,
    ask: () => Effect.void,
  }
}

/**
 * The typed subagent-limit errors fail inside the tool body and surface as
 * defects through the execute boundary's `Effect.orDie`; tests match on the
 * defect instance (mirrors task.test.ts).
 */
function defectOf(exit: Exit.Exit<unknown, unknown>): unknown {
  if (!Exit.isFailure(exit)) return undefined
  return exit.cause.reasons.find(Cause.isDieReason)?.defect
}

function reply(input: SessionPrompt.PromptInput, text: string): SessionV1.WithParts {
  const id = MessageID.ascending()
  return {
    info: {
      id,
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
      time: { created: Date.now() },
      finish: "stop",
    },
    parts: [{ id: PartID.ascending(), messageID: id, sessionID: input.sessionID, type: "text", text }],
  }
}

/**
 * promptOps whose child loop blocks on a per-session gate until the test opens
 * it. `started` fires once the child run actually began (after the spawn gate
 * and create), so the test knows the concurrency slot is held.
 */
function heldOps(input: {
  started: (sessionID: SessionID) => Effect.Effect<void>
  release: (sessionID: SessionID) => Effect.Effect<unknown>
}): TaskPromptOps {
  return {
    cancel: () => Effect.void,
    resolvePromptParts: (template) => Effect.succeed([{ type: "text" as const, text: template }]),
    prompt: (i) =>
      Effect.gen(function* () {
        yield* input.started(i.sessionID)
        yield* input.release(i.sessionID)
        return reply(i, "done")
      }),
  }
}

const instantOps: TaskPromptOps = {
  cancel: () => Effect.void,
  resolvePromptParts: (template) => Effect.succeed([{ type: "text" as const, text: template }]),
  prompt: (i) => Effect.succeed(reply(i, "done")),
}

describe("nested concurrency cap", () => {
  // The CORE acceptance criterion: the deadlock counterexample from the design
  // note. Cap 2, two parallel L2 FOREGROUND tasks each with one L3 child. Under
  // a tree-wide semaphore the two L2 parents would hold both permits and their
  // L3 children would never get one → deadlock. The per-spawner cap gives every
  // level its own budget, so the whole shape completes without hanging.
  it.instance("deadlock counterexample: two parallel L2 foreground tasks each with an L3 child complete", () =>
    Effect.gen(function* () {
      SubagentLimits.__testHooks.concurrency = 2
      const sessions = yield* Session.Service
      const tool = yield* TaskTool
      const def = yield* tool.init()
      const { chat: root, assistant: rootAssistant } = yield* seed()

      // Two L2 sessions hang until both have started, proving they run in
      // parallel; once both are up each spawns its L3 child (an independent
      // per-spawner budget) and only then are released.
      const l2Up = yield* Deferred.make<void>()
      let l2Count = 0
      const l3Done = yield* Deferred.make<void>()

      // The L2 loop: spawn one L3 child (fresh tool def gated by the same seam),
      // then finish. The L3 child uses instant ops. The nested gen needs
      // Session.Service (seedMessages); the prompt op is typed R=never, so the
      // captured service instance is provided back in explicitly.
      const l2Ops: TaskPromptOps = {
        cancel: () => Effect.void,
        resolvePromptParts: (template) => Effect.succeed([{ type: "text" as const, text: template }]),
        prompt: (i) =>
          Effect.gen(function* () {
            // Mark this L2 up and wait until BOTH L2s are up (true parallelism).
            l2Count += 1
            if (l2Count === 2) yield* Deferred.succeed(l2Up, undefined)
            yield* Deferred.await(l2Up)
            // Each L2 spawns exactly one L3 child from its own session.
            const childAssistant = yield* seedMessages(i.sessionID)
            yield* def.execute(
              taskParams,
              taskCtx({ sessionID: i.sessionID, messageID: childAssistant.id, promptOps: instantOps }),
            )
            yield* Deferred.await(l3Done)
            return reply(i, "l2-done")
          }).pipe(Effect.provideService(Session.Service, sessions)),
      }

      // Root launches two L2 foreground tasks concurrently (parallel tool calls).
      const fiber = yield* Effect.all(
        [
          def.execute(taskParams, taskCtx({ sessionID: root.id, messageID: rootAssistant.id, promptOps: l2Ops })),
          def.execute(taskParams, taskCtx({ sessionID: root.id, messageID: rootAssistant.id, promptOps: l2Ops })),
        ],
        { concurrency: "unbounded" },
      ).pipe(Effect.forkChild)

      // Both L2s must come up in parallel; if the cap deadlocked they never would.
      yield* awaitWithTimeout(Deferred.await(l2Up), "two L2 foreground tasks never ran in parallel (deadlock)", "10 seconds")

      // Each L2 has spawned its L3 child — no permit starvation across levels.
      const l2s = yield* sessions.children(root.id)
      expect(l2s).toHaveLength(2)
      for (const l2 of l2s) {
        yield* awaitWithTimeout(
          Effect.gen(function* () {
            return (yield* sessions.children(l2.id)).length === 1 ? true : yield* Effect.fail("no L3 yet")
          }).pipe(Effect.retry({ times: 200 }), Effect.timeout("10 seconds")),
          `L2 ${l2.id} never spawned its L3 child`,
        )
      }

      yield* Deferred.succeed(l3Done, undefined)
      const results = yield* awaitWithTimeout(Fiber.join(fiber), "L2 chain never completed", "15 seconds")
      expect(results).toHaveLength(2)
      for (const r of results) expect(r.output).toContain(`state="completed"`)
    }).pipe(
      Effect.ensuring(Effect.sync(() => (SubagentLimits.__testHooks.concurrency = undefined))),
    ),
    25_000,
  )

  it.instance("an over-cap concurrent spawn fails fast with SubagentConcurrencyError instead of queuing", () =>
    Effect.gen(function* () {
      SubagentLimits.__testHooks.concurrency = 2
      const sessions = yield* Session.Service
      const tool = yield* TaskTool
      const def = yield* tool.init()
      const { chat: root, assistant } = yield* seed()

      const release = yield* Deferred.make<void>()
      let started = 0
      const upTwo = yield* Deferred.make<void>()
      const ops = heldOps({
        // The condition must be re-read PER call, not captured once at setup:
        // increment, then signal only when this call is the second to start.
        started: () =>
          Effect.gen(function* () {
            started += 1
            if (started >= 2) yield* Deferred.succeed(upTwo, undefined)
          }),
        release: () => Deferred.await(release),
      })

      // Two children fill the cap and hang.
      const held = yield* Effect.all(
        [
          def.execute(taskParams, taskCtx({ sessionID: root.id, messageID: assistant.id, promptOps: ops })),
          def.execute(taskParams, taskCtx({ sessionID: root.id, messageID: assistant.id, promptOps: ops })),
        ],
        { concurrency: "unbounded" },
      ).pipe(Effect.forkChild)
      yield* awaitWithTimeout(Deferred.await(upTwo), "two children never filled the cap", "10 seconds")

      // The third concurrent spawn from the SAME spawner is refused immediately
      // — no waiting, no queuing — with the typed error naming the limit.
      const exit = yield* awaitWithTimeout(
        def
          .execute(taskParams, taskCtx({ sessionID: root.id, messageID: assistant.id, promptOps: instantOps }))
          .pipe(Effect.exit),
        "over-cap spawn queued instead of failing fast",
        "5 seconds",
      )
      const error = defectOf(exit)
      expect(error).toBeInstanceOf(SubagentLimits.SubagentConcurrencyError)
      const concErr = error as SubagentLimits.SubagentConcurrencyError
      expect(concErr.running).toBe(2)
      expect(concErr.limit).toBe(2)
      expect(concErr.message).toContain("2")
      // No third child session was created by the refused spawn.
      expect(yield* sessions.children(root.id)).toHaveLength(2)

      yield* Deferred.succeed(release, undefined)
      yield* awaitWithTimeout(Fiber.join(held), "held children never finished", "10 seconds")
    }).pipe(
      Effect.ensuring(Effect.sync(() => (SubagentLimits.__testHooks.concurrency = undefined))),
    ),
    20_000,
  )

  it.instance("the running counter decrements after a child finishes so the slot is reusable (no leak)", () =>
    Effect.gen(function* () {
      SubagentLimits.__testHooks.concurrency = 1
      const sessions = yield* Session.Service
      const tool = yield* TaskTool
      const def = yield* tool.init()
      const { chat: root, assistant } = yield* seed()

      // Run cap+1 spawns SEQUENTIALLY: each finishes before the next starts, so
      // a correctly-decremented counter never trips the cap.
      for (let i = 0; i < 3; i++) {
        const result = yield* def.execute(
          taskParams,
          taskCtx({ sessionID: root.id, messageID: assistant.id, promptOps: instantOps }),
        )
        expect(result.output).toContain(`state="completed"`)
      }
      expect(yield* sessions.children(root.id)).toHaveLength(3)
    }).pipe(
      Effect.ensuring(Effect.sync(() => (SubagentLimits.__testHooks.concurrency = undefined))),
    ),
  )

  it.instance("the running counter decrements on abort so an aborted slot is released (no leak)", () =>
    Effect.gen(function* () {
      SubagentLimits.__testHooks.concurrency = 1
      const sessions = yield* Session.Service
      const tool = yield* TaskTool
      const def = yield* tool.init()
      const { chat: root, assistant } = yield* seed()

      // Mirrors the proven abort pattern in task.test.ts: the child loop hangs
      // on a raw promise that `cancel` resolves, so the foreground task settles
      // when the abort signal fires (cancel never has to interrupt a permit
      // waiter — the fail-fast cap has none).
      const abort = new AbortController()
      const ready = defer<SessionID>()
      const cancelled = defer<SessionID>()
      const ops: TaskPromptOps = {
        cancel: (sessionID) =>
          Effect.sync(() => {
            cancelled.resolve(sessionID)
          }),
        resolvePromptParts: (template) => Effect.succeed([{ type: "text" as const, text: template }]),
        prompt: (i) =>
          Effect.promise(() => {
            ready.resolve(i.sessionID)
            return cancelled.promise
          }).pipe(Effect.as(reply(i, "cancelled"))),
      }

      const fiber = yield* def
        .execute(
          taskParams,
          taskCtx({ sessionID: root.id, messageID: assistant.id, promptOps: ops, abort: abort.signal }),
        )
        .pipe(Effect.forkChild)
      const childID = yield* awaitWithTimeout(
        Effect.promise(() => ready.promise),
        "first child never started",
        "10 seconds",
      )

      // Abort must never hang on a permit (fail-fast cap has no waiter) and the
      // slot must come back even though the run was interrupted, not completed.
      abort.abort()
      expect(yield* awaitWithTimeout(Effect.promise(() => cancelled.promise), "abort never reached the child", "10 seconds")).toBe(
        childID,
      )
      const exit = yield* awaitWithTimeout(Fiber.await(fiber), "aborted child never settled", "10 seconds")
      expect(Exit.isSuccess(exit)).toBe(true)

      // The slot is free again: a fresh spawn under cap 1 succeeds.
      const result = yield* def.execute(
        taskParams,
        taskCtx({ sessionID: root.id, messageID: assistant.id, promptOps: instantOps }),
      )
      expect(result.output).toContain(`state="completed"`)
      expect((yield* sessions.children(root.id)).length).toBe(2)
    }).pipe(
      Effect.ensuring(Effect.sync(() => (SubagentLimits.__testHooks.concurrency = undefined))),
    ),
    20_000,
  )

  it.instance("the cap is per-spawner: a sibling spawner keeps its own independent budget", () =>
    Effect.gen(function* () {
      SubagentLimits.__testHooks.concurrency = 1
      const sessions = yield* Session.Service
      const tool = yield* TaskTool
      const def = yield* tool.init()
      const { chat: root, assistant: rootAssistant } = yield* seed()
      // Two sibling spawner sessions under the same root.
      const spawnerA = yield* sessions.create({ parentID: root.id, title: "spawner A" })
      const aAssistant = yield* seedMessages(spawnerA.id)
      const spawnerB = yield* sessions.create({ parentID: root.id, title: "spawner B" })
      const bAssistant = yield* seedMessages(spawnerB.id)

      const release = yield* Deferred.make<void>()
      const aUp = yield* Deferred.make<void>()
      const bUp = yield* Deferred.make<void>()
      const opsFor = (up: Deferred.Deferred<void>): TaskPromptOps => ({
        cancel: () => Effect.void,
        resolvePromptParts: (template) => Effect.succeed([{ type: "text" as const, text: template }]),
        prompt: (i) =>
          Effect.gen(function* () {
            yield* Deferred.succeed(up, undefined)
            yield* Deferred.await(release)
            return reply(i, "done")
          }),
      })

      // A holds its single slot; B (a different spawner) still spawns even
      // though A is at its cap — budgets are independent per spawner.
      const fiber = yield* Effect.all(
        [
          def.execute(taskParams, taskCtx({ sessionID: spawnerA.id, messageID: aAssistant.id, promptOps: opsFor(aUp) })),
          def.execute(taskParams, taskCtx({ sessionID: spawnerB.id, messageID: bAssistant.id, promptOps: opsFor(bUp) })),
        ],
        { concurrency: "unbounded" },
      ).pipe(Effect.forkChild)

      yield* awaitWithTimeout(Deferred.await(aUp), "spawner A child never ran", "10 seconds")
      yield* awaitWithTimeout(Deferred.await(bUp), "spawner B was wrongly blocked by A's cap", "10 seconds")

      yield* Deferred.succeed(release, undefined)
      yield* awaitWithTimeout(Fiber.join(fiber), "sibling spawners never finished", "10 seconds")
      expect(yield* sessions.children(spawnerA.id)).toHaveLength(1)
      expect(yield* sessions.children(spawnerB.id)).toHaveLength(1)
    }).pipe(
      Effect.ensuring(Effect.sync(() => (SubagentLimits.__testHooks.concurrency = undefined))),
    ),
    20_000,
  )
})
