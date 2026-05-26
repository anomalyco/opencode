import { describe, expect, test } from "bun:test"
import { AppRuntime } from "../../src/effect/app-runtime"
import { InstanceRef } from "../../src/effect/instance-ref"
import type { InstanceContext } from "../../src/project/instance-context"
import { ProjectID } from "../../src/project/schema"
import { SessionGoal } from "../../src/session/goal"
import { MessageV2 } from "../../src/session/message-v2"
import { Session } from "../../src/session/session"
import { MessageID, PartID, SessionID } from "../../src/session/schema"
import { provideTestInstance, tmpdir } from "../fixture/fixture"
import { Effect } from "effect"

let activeContext: InstanceContext | undefined

function runIn<A>(directory: string, fn: (directory: string) => A) {
  return provideTestInstance({
    directory,
    fn: async (ctx) => {
      activeContext = ctx
      try {
        return await fn(directory)
      } finally {
        activeContext = undefined
      }
    },
  })
}

async function run<A>(fn: (directory: string) => A) {
  await using tmp = await tmpdir({ git: true })
  return await runIn(tmp.path, fn)
}

function effect<A, E, R>(value: Effect.Effect<A, E, R>) {
  const scoped = activeContext ? value.pipe(Effect.provideService(InstanceRef, activeContext)) : value
  return AppRuntime.runPromise(scoped as never) as Promise<A>
}

async function expectRejects(fn: () => Promise<unknown>, message: string) {
  let error: unknown
  try {
    await fn()
  } catch (e) {
    error = e
  }
  expect(error).toBeTruthy()
  expect(error instanceof Error ? error.message : String(error)).toContain(message)
}

describe("SessionGoal", () => {
  test("creates one persistent goal per session", async () => {
    await using tmp = await tmpdir({ git: true })
    const goal = await runIn(tmp.path, async () => {
      const session = await effect(Session.Service.use((svc) => svc.create({ title: "goal-test" })))
      return effect(
        SessionGoal.Service.use((svc) =>
          svc.create({
            sessionID: session.id,
            objective: "fix failing tests",
            tokenBudget: 1000,
          }),
        ),
      )
    })

    expect(goal.id.startsWith("goal_")).toBe(true)
    expect(goal.status).toBe("active")
    expect(goal.objective).toBe("fix failing tests")
    expect(goal.tokens.used).toBe(0)
    expect(goal.tokens.budget).toBe(1000)

    const resumed = await runIn(tmp.path, () => effect(SessionGoal.Service.use((svc) => svc.get(goal.sessionID))))
    expect(resumed?.id).toBe(goal.id)
    expect(resumed?.objective).toBe("fix failing tests")

    await expectRejects(
      () =>
        runIn(tmp.path, () =>
          effect(
            SessionGoal.Service.use((svc) =>
              svc.create({
                sessionID: goal.sessionID,
                objective: "second goal",
              }),
            ),
          ),
        ),
      "Goal already exists",
    )
  })

  test("validates objective and budget", async () => {
    await expectRejects(
      () =>
        run(() =>
          effect(
            SessionGoal.Service.use((svc) =>
              svc.create({
                sessionID: SessionID.descending(),
                objective: " ",
              }),
            ),
          ),
        ),
      "Goal objective is required",
    )

    await expectRejects(
      () =>
        run(() =>
          effect(
            SessionGoal.Service.use((svc) =>
              svc.create({
                sessionID: SessionID.descending(),
                objective: "x".repeat(4001),
              }),
            ),
          ),
        ),
      "Goal objective is too long",
    )

    await expectRejects(
      () =>
        run(() =>
          effect(
            SessionGoal.Service.use((svc) =>
              svc.create({
                sessionID: SessionID.descending(),
                objective: "valid",
                tokenBudget: 0,
              }),
            ),
          ),
        ),
      "Goal token budget must be positive",
    )
  })

  test("updates lifecycle, clears, and marks budget limited from accounting", async () => {
    const result = await run(async () => {
      const session = await effect(Session.Service.use((svc) => svc.create({ title: "goal-accounting" })))
      const created = await effect(
        SessionGoal.Service.use((svc) =>
          svc.create({
            sessionID: session.id,
            objective: "ship goal accounting",
            tokenBudget: 10,
          }),
        ),
      )
      const paused = await effect(
        SessionGoal.Service.use((svc) => svc.update({ sessionID: session.id, status: "paused" })),
      )
      const edited = await effect(
        SessionGoal.Service.use((svc) =>
          svc.update({
            sessionID: session.id,
            objective: "ship edited goal accounting",
            status: "active",
          }),
        ),
      )
      const limited = await effect(
        SessionGoal.Service.use((svc) => svc.account({ sessionID: session.id, tokens: 11, seconds: 2 })),
      )
      if (!limited) throw new Error("Expected goal accounting result")
      const afterLimited = await effect(
        SessionGoal.Service.use((svc) => svc.account({ sessionID: session.id, tokens: 5, seconds: 1 })),
      )
      if (!afterLimited) throw new Error("Expected budget-limited goal")
      await effect(SessionGoal.Service.use((svc) => svc.clear(session.id)))
      return {
        created,
        paused,
        edited,
        limited,
        afterLimited,
        cleared: await effect(SessionGoal.Service.use((svc) => svc.get(session.id))),
      }
    })

    expect(result.paused.status).toBe("paused")
    expect(result.edited.objective).toBe("ship edited goal accounting")
    expect(result.limited.status).toBe("budget_limited")
    expect(result.limited.tokens.used).toBe(11)
    expect(result.limited.time.used).toBe(2)
    expect(result.afterLimited.tokens.used).toBe(11)
    expect(result.afterLimited.time.used).toBe(2)
    expect(result.cleared).toBeUndefined()
    expect(result.created.id).toBe(result.limited.id)
  })

  test("persists cleared token budget", async () => {
    const goal = await run(async () => {
      const session = await effect(Session.Service.use((svc) => svc.create({ title: "goal-budget-clear" })))
      await effect(
        SessionGoal.Service.use((svc) =>
          svc.create({
            sessionID: session.id,
            objective: "clear the budget",
            tokenBudget: 25,
          }),
        ),
      )
      await effect(SessionGoal.Service.use((svc) => svc.update({ sessionID: session.id, tokenBudget: null })))
      return effect(SessionGoal.Service.use((svc) => svc.get(session.id)))
    })

    expect(goal?.tokens.budget).toBeUndefined()
  })

  test("marks active goals budget limited when lowering budget below usage", async () => {
    const goal = await run(async () => {
      const session = await effect(Session.Service.use((svc) => svc.create({ title: "goal-budget-lower" })))
      await effect(SessionGoal.Service.use((svc) => svc.create({ sessionID: session.id, objective: "lower budget" })))
      await effect(SessionGoal.Service.use((svc) => svc.account({ sessionID: session.id, tokens: 8, seconds: 0 })))
      return effect(SessionGoal.Service.use((svc) => svc.update({ sessionID: session.id, tokenBudget: 8 })))
    })

    expect(goal.status).toBe("budget_limited")
    expect(goal.tokens.used).toBe(8)
    expect(goal.tokens.budget).toBe(8)
  })

  test("recomputes budget-limited status when budget is raised or cleared", async () => {
    const result = await run(async () => {
      const session = await effect(Session.Service.use((svc) => svc.create({ title: "goal-budget-recompute" })))
      await effect(
        SessionGoal.Service.use((svc) =>
          svc.create({ sessionID: session.id, objective: "recover from budget limit", tokenBudget: 5 }),
        ),
      )
      await effect(SessionGoal.Service.use((svc) => svc.account({ sessionID: session.id, tokens: 5, seconds: 0 })))
      const raised = await effect(SessionGoal.Service.use((svc) => svc.update({ sessionID: session.id, tokenBudget: 6 })))
      const lowered = await effect(
        SessionGoal.Service.use((svc) => svc.update({ sessionID: session.id, tokenBudget: 5 })),
      )
      const cleared = await effect(
        SessionGoal.Service.use((svc) => svc.update({ sessionID: session.id, tokenBudget: null })),
      )
      return { raised, lowered, cleared }
    })

    expect(result.raised.status).toBe("active")
    expect(result.raised.tokens.budget).toBe(6)
    expect(result.lowered.status).toBe("budget_limited")
    expect(result.cleared.status).toBe("active")
    expect(result.cleared.tokens.budget).toBeUndefined()
  })

  test("accounts completion time after tokens exhaust the budget", async () => {
    const result = await run(async () => {
      const session = await effect(Session.Service.use((svc) => svc.create({ title: "goal-budget-time" })))
      await effect(
        SessionGoal.Service.use((svc) =>
          svc.create({ sessionID: session.id, objective: "count budget time", tokenBudget: 7 }),
        ),
      )
      const messageID = MessageID.ascending()
      await effect(
        SessionGoal.Service.use((svc) => svc.account({ sessionID: session.id, messageID, tokens: 7, seconds: 0 })),
      )
      const afterCompletion = await effect(
        SessionGoal.Service.use((svc) => svc.account({ sessionID: session.id, messageID, tokens: 0, seconds: 3 })),
      )
      const afterLater = await effect(
        SessionGoal.Service.use((svc) =>
          svc.account({ sessionID: session.id, messageID: MessageID.ascending(), tokens: 0, seconds: 5 }),
        ),
      )
      return { afterCompletion, afterLater }
    })

    expect(result.afterCompletion?.status).toBe("budget_limited")
    expect(result.afterCompletion?.tokens.used).toBe(7)
    expect(result.afterCompletion?.time.used).toBe(3)
    expect(result.afterLater?.time.used).toBe(3)
  })

  test("accounts non-cached input and output tokens from step finish parts", async () => {
    const goal = await run(async (directory) => {
      const session = await effect(Session.Service.use((svc) => svc.create({ title: "goal-step-finish" })))
      await effect(
        SessionGoal.Service.use((svc) =>
          svc.create({
            sessionID: session.id,
            objective: "count tokens",
            tokenBudget: 7,
          }),
        ),
      )
      const messageID = MessageID.ascending()
      await effect(
        Session.Service.use((svc) =>
          svc.updateMessage({
            id: messageID,
            sessionID: session.id,
            role: "assistant",
            mode: "build",
            path: { cwd: directory, root: directory },
            cost: 0,
            tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
            modelID: "test",
            providerID: "test",
            time: { created: Date.now() },
          } as MessageV2.Assistant),
        ),
      )
      await effect(
        Session.Service.use((svc) =>
          svc.updatePart({
            id: PartID.ascending(),
            messageID,
            sessionID: session.id,
            type: "step-finish",
            reason: "stop",
            cost: 0,
            tokens: { input: 4, output: 3, reasoning: 3, cache: { read: 50, write: 50 } },
          }),
        ),
      )
      return effect(SessionGoal.Service.use((svc) => svc.get(session.id)))
    })

    expect(goal?.tokens.used).toBe(7)
    expect(goal?.status).toBe("budget_limited")
  })

  test("does not count summary step finish parts against active goals", async () => {
    const goal = await run(async (directory) => {
      const session = await effect(Session.Service.use((svc) => svc.create({ title: "goal-summary-step-finish" })))
      await effect(
        SessionGoal.Service.use((svc) =>
          svc.create({
            sessionID: session.id,
            objective: "ignore summary tokens",
            tokenBudget: 7,
          }),
        ),
      )
      const messageID = MessageID.ascending()
      await effect(
        Session.Service.use((svc) =>
          svc.updateMessage({
            id: messageID,
            sessionID: session.id,
            role: "assistant",
            mode: "compaction",
            agent: "compaction",
            summary: true,
            path: { cwd: directory, root: directory },
            parentID: MessageID.ascending(),
            cost: 0,
            tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
            modelID: "test",
            providerID: "test",
            time: { created: Date.now() },
          } as MessageV2.Assistant),
        ),
      )
      await effect(
        Session.Service.use((svc) =>
          svc.updatePart({
            id: PartID.ascending(),
            messageID,
            sessionID: session.id,
            type: "step-finish",
            reason: "stop",
            cost: 0,
            tokens: { input: 4, output: 3, reasoning: 0, cache: { read: 0, write: 0 } },
          }),
        ),
      )
      return effect(SessionGoal.Service.use((svc) => svc.get(session.id)))
    })

    expect(goal?.tokens.used).toBe(0)
    expect(goal?.status).toBe("active")
  })

  test("does not double count repeated step finish part updates", async () => {
    const goal = await run(async (directory) => {
      const session = await effect(Session.Service.use((svc) => svc.create({ title: "goal-step-finish-upsert" })))
      await effect(
        SessionGoal.Service.use((svc) =>
          svc.create({
            sessionID: session.id,
            objective: "count tokens once",
            tokenBudget: 100,
          }),
        ),
      )
      const messageID = MessageID.ascending()
      const partID = PartID.ascending()
      await effect(
        Session.Service.use((svc) =>
          svc.updateMessage({
            id: messageID,
            sessionID: session.id,
            role: "assistant",
            mode: "build",
            agent: "build",
            path: { cwd: directory, root: directory },
            parentID: MessageID.ascending(),
            cost: 0,
            tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
            modelID: "test",
            providerID: "test",
            time: { created: Date.now() },
          } as MessageV2.Assistant),
        ),
      )
      const part = {
        id: partID,
        messageID,
        sessionID: session.id,
        type: "step-finish" as const,
        reason: "stop",
        cost: 0,
        tokens: { input: 4, output: 3, reasoning: 0, cache: { read: 0, write: 0 } },
      }
      await effect(Session.Service.use((svc) => svc.updatePart(part)))
      await effect(Session.Service.use((svc) => svc.updatePart(part)))
      return effect(SessionGoal.Service.use((svc) => svc.get(session.id)))
    })

    expect(goal?.tokens.used).toBe(7)
    expect(goal?.status).toBe("active")
  })

  test("accounts wall-clock time once when assistant message completes", async () => {
    const goal = await run(async (directory) => {
      const session = await effect(Session.Service.use((svc) => svc.create({ title: "goal-time" })))
      await effect(SessionGoal.Service.use((svc) => svc.create({ sessionID: session.id, objective: "count time" })))
      const messageID = MessageID.ascending()
      const created = Date.now() - 2_100
      await effect(
        Session.Service.use((svc) =>
          svc.updateMessage({
            id: messageID,
            sessionID: session.id,
            role: "assistant",
            mode: "build",
            agent: "build",
            path: { cwd: directory, root: directory },
            parentID: MessageID.ascending(),
            cost: 0,
            tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
            modelID: "test",
            providerID: "test",
            time: { created },
          } as MessageV2.Assistant),
        ),
      )
      await effect(
        Session.Service.use((svc) =>
          svc.updateMessage({
            id: messageID,
            sessionID: session.id,
            role: "assistant",
            mode: "build",
            agent: "build",
            path: { cwd: directory, root: directory },
            parentID: MessageID.ascending(),
            cost: 0,
            tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
            modelID: "test",
            providerID: "test",
            time: { created, completed: created + 2_100 },
          } as MessageV2.Assistant),
        ),
      )
      await effect(
        Session.Service.use((svc) =>
          svc.updateMessage({
            id: messageID,
            sessionID: session.id,
            role: "assistant",
            mode: "build",
            agent: "build",
            path: { cwd: directory, root: directory },
            parentID: MessageID.ascending(),
            cost: 0,
            tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
            modelID: "test",
            providerID: "test",
            time: { created, completed: created + 2_100 },
          } as MessageV2.Assistant),
        ),
      )
      return effect(SessionGoal.Service.use((svc) => svc.get(session.id)))
    })

    expect(goal?.time.used).toBe(3)
  })

  test("model update can only mark a goal complete", async () => {
    await run(async () => {
      const session = await effect(Session.Service.use((svc) => svc.create({ title: "goal-model" })))
      await effect(SessionGoal.Service.use((svc) => svc.create({ sessionID: session.id, objective: "finish it" })))
      const messageID = MessageID.ascending()

      await expectRejects(
        () =>
          effect(SessionGoal.Service.use((svc) => svc.modelUpdate({ sessionID: session.id, status: "paused" }))),
        "Models can only mark goals complete",
      )

      const complete = await effect(
        SessionGoal.Service.use((svc) => svc.modelUpdate({ sessionID: session.id, messageID, status: "complete" })),
      )
      expect(complete.status).toBe("complete")
      const afterComplete = await effect(
        SessionGoal.Service.use((svc) => svc.account({ sessionID: session.id, messageID, tokens: 5, seconds: 1 })),
      )
      expect(afterComplete?.status).toBe("complete")
      expect(afterComplete?.tokens.used).toBe(5)
      expect(afterComplete?.time.used).toBe(1)

      const later = await effect(
        SessionGoal.Service.use((svc) =>
          svc.account({ sessionID: session.id, messageID: MessageID.ascending(), tokens: 5, seconds: 1 }),
        ),
      )
      expect(later?.tokens.used).toBe(5)
      expect(later?.time.used).toBe(1)
    })
  })

  test("counts the assistant turn that marks a goal complete", async () => {
    const result = await run(async (directory) => {
      const session = await effect(Session.Service.use((svc) => svc.create({ title: "goal-complete-accounting" })))
      await effect(
        SessionGoal.Service.use((svc) =>
          svc.create({
            sessionID: session.id,
            objective: "count the final turn",
            tokenBudget: 3,
          }),
        ),
      )

      const messageID = MessageID.ascending()
      const created = Date.now() - 1_100
      const assistant = {
        id: messageID,
        sessionID: session.id,
        role: "assistant",
        mode: "build",
        agent: "build",
        path: { cwd: directory, root: directory },
        parentID: MessageID.ascending(),
        cost: 0,
        tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
        modelID: "test",
        providerID: "test",
        time: { created },
      } as MessageV2.Assistant

      await effect(Session.Service.use((svc) => svc.updateMessage(assistant)))
      await effect(
        SessionGoal.Service.use((svc) => svc.modelUpdate({ sessionID: session.id, messageID, status: "complete" })),
      )
      await effect(
        Session.Service.use((svc) =>
          svc.updatePart({
            id: PartID.ascending(),
            messageID,
            sessionID: session.id,
            type: "step-finish",
            reason: "tool-calls",
            cost: 0,
            tokens: { input: 2, output: 3, reasoning: 4, cache: { read: 50, write: 50 } },
          }),
        ),
      )
      await effect(
        Session.Service.use((svc) => svc.updateMessage({ ...assistant, time: { created, completed: created + 1_100 } })),
      )
      const afterComplete = await effect(SessionGoal.Service.use((svc) => svc.get(session.id)))

      const laterMessageID = MessageID.ascending()
      const laterCreated = Date.now() - 1_000
      const laterAssistant = {
        ...assistant,
        id: laterMessageID,
        parentID: messageID,
        time: { created: laterCreated },
      }
      await effect(Session.Service.use((svc) => svc.updateMessage(laterAssistant)))
      await effect(
        Session.Service.use((svc) =>
          svc.updatePart({
            id: PartID.ascending(),
            messageID: laterMessageID,
            sessionID: session.id,
            type: "step-finish",
            reason: "stop",
            cost: 0,
            tokens: { input: 10, output: 10, reasoning: 0, cache: { read: 0, write: 0 } },
          }),
        ),
      )
      await effect(
        Session.Service.use((svc) =>
          svc.updateMessage({ ...laterAssistant, time: { created: laterCreated, completed: laterCreated + 1_000 } }),
        ),
      )

      return {
        afterComplete,
        afterLater: await effect(SessionGoal.Service.use((svc) => svc.get(session.id))),
      }
    })

    expect(result.afterComplete?.status).toBe("complete")
    expect(result.afterComplete?.tokens.used).toBe(5)
    expect(result.afterComplete?.time.used).toBe(2)
    expect(result.afterLater?.status).toBe("complete")
    expect(result.afterLater?.tokens.used).toBe(5)
    expect(result.afterLater?.time.used).toBe(2)
  })

  test("persists goal after instance reload", async () => {
    await using tmp = await tmpdir({ git: true })
    const created = await runIn(tmp.path, async () => {
      const session = await effect(Session.Service.use((svc) => svc.create({ title: "goal-reload" })))
      return effect(
        SessionGoal.Service.use((svc) =>
          svc.create({
            sessionID: session.id,
            objective: "survive process restart",
            tokenBudget: 100,
          }),
        ),
      )
    })

    const loaded = await runIn(tmp.path, () => effect(SessionGoal.Service.use((svc) => svc.get(created.sessionID))))
    expect(loaded?.id).toBe(created.id)
    expect(loaded?.objective).toBe("survive process restart")
  })

  test("lists active goals for runtime startup scheduling", async () => {
    await run(async () => {
      const result = await effect(
        Session.Service.use((sessions) =>
          SessionGoal.Service.use((goals) =>
            Effect.gen(function* () {
              const activeSession = yield* sessions.create({ title: "active-goal" })
              const pausedSession = yield* sessions.create({ title: "paused-goal" })
              const completeSession = yield* sessions.create({ title: "complete-goal" })
              yield* goals.create({ sessionID: activeSession.id, objective: "keep going" })
              yield* goals.create({ sessionID: pausedSession.id, objective: "pause" })
              yield* goals.update({ sessionID: pausedSession.id, status: "paused" })
              yield* goals.create({ sessionID: completeSession.id, objective: "done" })
              yield* goals.modelUpdate({ sessionID: completeSession.id, status: "complete" })
              return {
                activeSession,
                pausedSession,
                completeSession,
                active: yield* goals.listActive(),
              }
            }),
          ),
        ),
      )

      expect(result.active.some((goal) => goal.sessionID === result.activeSession.id)).toBe(true)
      expect(result.active.some((goal) => goal.sessionID === result.pausedSession.id)).toBe(false)
      expect(result.active.some((goal) => goal.sessionID === result.completeSession.id)).toBe(false)
    })
  })

  test("lists active goals only for unarchived sessions in the requested project", async () => {
    await run(async () => {
      const result = await effect(
        Session.Service.use((sessions) =>
          SessionGoal.Service.use((goals) =>
            Effect.gen(function* () {
              const activeSession = yield* sessions.create({ title: "active-goal" })
              const archivedSession = yield* sessions.create({ title: "archived-goal" })
              yield* goals.create({ sessionID: activeSession.id, objective: "keep running" })
              yield* goals.create({ sessionID: archivedSession.id, objective: "do not resume" })
              yield* sessions.setArchived({ sessionID: archivedSession.id, time: Date.now() })
              return {
                activeSession,
                archivedSession,
                active: yield* goals.listActive({ projectID: activeSession.projectID }),
                wrongProject: yield* goals.listActive({ projectID: ProjectID.global }),
              }
            }),
          ),
        ),
      )

      expect(result.active.some((goal) => goal.sessionID === result.activeSession.id)).toBe(true)
      expect(result.active.some((goal) => goal.sessionID === result.archivedSession.id)).toBe(false)
      expect(result.wrongProject).toHaveLength(0)
    })
  })
})
