import { ActiveGoalExistsError, NoActiveGoalError } from "./errors"
import { checkGoalBudget } from "./budget"
import { createGoalCheckpoint } from "./checkpoints"
import { appendGoalEvent, readGoalEvents } from "./events"
import { createDeterministicGoalPlan } from "./planner"
import { renderGoalLogs, renderGoalStatus, renderNoActiveGoal } from "./renderer"
import { archiveActiveGoal, loadActiveGoal, saveActiveGoal, type ActiveGoalState } from "./store"
import { transitionGoal } from "./state-machine"
import type { Goal, GoalEvent } from "./types"
import type { InstanceContext } from "@/project/instance-context"

export interface GoalStatusResult {
  active: ActiveGoalState | null
  output: string
}

export interface GoalLogsResult {
  events: GoalEvent[]
  output: string
}

export interface GoalManager {
  init(): Promise<ActiveGoalState | null>
  create(objective: string): Promise<Goal>
  status(): Promise<GoalStatusResult>
  logs(): Promise<GoalLogsResult>
  pause(): Promise<Goal>
  resume(): Promise<Goal>
  enforceBudget(): Promise<Goal>
  clear(): Promise<Goal>
}

export interface GoalManagerOptions {
  now?: () => string
  id?: () => string
  eventId?: () => string
  checkpointId?: () => string
  planId?: () => string
}

function titleFromObjective(objective: string): string {
  return objective.trim().replace(/\s+/g, " ")
}

function initialGoal(id: string, objective: string, now: string): Goal {
  return {
    id,
    title: titleFromObjective(objective),
    objective,
    state: "CREATED",
    createdAt: now,
    updatedAt: now,
    progress: {
      totalSteps: 0,
      completedSteps: 0,
      failedSteps: 0,
      blockedSteps: 0,
      percentComplete: 0,
    },
    budget: {
      usedTokens: 0,
      usedRuntimeMs: 0,
      usedSteps: 0,
      usedCostUsd: 0,
    },
  }
}

export function createGoalManager(ctx: Pick<InstanceContext, "directory" | "worktree">, options: GoalManagerOptions = {}): GoalManager {
  const now = options.now ?? (() => new Date().toISOString())
  const id = options.id ?? (() => `goal_${crypto.randomUUID()}`)
  const eventId = options.eventId ?? (() => `event_${crypto.randomUUID()}`)
  const checkpointId = options.checkpointId ?? (() => `checkpoint_${crypto.randomUUID()}`)
  const planId = options.planId ?? (() => `plan_${crypto.randomUUID()}`)

  async function event(goal: Goal, type: GoalEvent["type"], message: string, metadata?: Record<string, unknown>) {
    await appendGoalEvent(ctx, {
      id: eventId(),
      goalId: goal.id,
      type,
      message,
      metadata,
      createdAt: now(),
    })
  }

  return {
    async init() {
      return loadActiveGoal(ctx)
    },

    async create(objective: string) {
      const existing = await loadActiveGoal(ctx)
      if (existing) throw new ActiveGoalExistsError({ goalId: existing.goal.id })

      const created = initialGoal(id(), objective, now())
      const plan = createDeterministicGoalPlan(created, { id: planId(), now: now() })
      const planned = { ...created, planId: plan.id, progress: { ...created.progress, totalSteps: plan.steps.length } }
      await saveActiveGoal(ctx, { goal: planned, plan })
      await event(planned, "GOAL_CREATED", "Goal created")
      return planned
    },

    async status() {
      const active = await loadActiveGoal(ctx)
      return {
        active,
        output: active ? renderGoalStatus(active) : renderNoActiveGoal(),
      }
    },

    async logs() {
      const active = await loadActiveGoal(ctx)
      if (!active) return { events: [], output: renderGoalLogs([]) }
      const events = await readGoalEvents(ctx)
      return { events, output: renderGoalLogs(events) }
    },

    async pause() {
      const active = await loadActiveGoal(ctx)
      if (!active) throw new NoActiveGoalError({ operation: "pause" })

      const paused = transitionGoal(active.goal, "PAUSED", { now: now() })
      await saveActiveGoal(ctx, { goal: paused, plan: active.plan })
      await event(paused, "GOAL_PAUSED", "Goal paused")
      await createGoalCheckpoint(ctx, {
        id: checkpointId(),
        goal: paused,
        plan: active.plan,
        createdAt: now(),
      })
      return paused
    },

    async resume() {
      const active = await loadActiveGoal(ctx)
      if (!active) throw new NoActiveGoalError({ operation: "resume" })

      const resumed = transitionGoal(active.goal, "ACTIVE", { now: now() })
      await saveActiveGoal(ctx, { goal: resumed, plan: active.plan })
      await event(resumed, "GOAL_RESUMED", "Goal resumed")
      await createGoalCheckpoint(ctx, {
        id: checkpointId(),
        goal: resumed,
        plan: active.plan,
        createdAt: now(),
      })
      return resumed
    },

    async enforceBudget() {
      const active = await loadActiveGoal(ctx)
      if (!active) throw new NoActiveGoalError({ operation: "budget" })

      const exceeded = checkGoalBudget(active.goal)
      if (!exceeded) return active.goal

      const budgetExceeded = transitionGoal(active.goal, "BUDGET_EXCEEDED", { now: now() })
      await saveActiveGoal(ctx, { goal: budgetExceeded, plan: active.plan })
      await event(budgetExceeded, "BUDGET_EXCEEDED", "Goal budget exceeded", {
        metric: exceeded.metric,
        used: exceeded.used,
        max: exceeded.max,
      })
      await createGoalCheckpoint(ctx, {
        id: checkpointId(),
        goal: budgetExceeded,
        plan: active.plan,
        createdAt: now(),
      })
      return budgetExceeded
    },

    async clear() {
      const active = await loadActiveGoal(ctx)
      if (!active) throw new ActiveGoalExistsError({ goalId: "" })

      const cancelled = transitionGoal(active.goal, "CANCELLED", { now: now() })
      await saveActiveGoal(ctx, { goal: cancelled, plan: active.plan })
      await event(cancelled, "GOAL_CANCELLED", "Goal cancelled")
      await createGoalCheckpoint(ctx, {
        id: checkpointId(),
        goal: cancelled,
        plan: active.plan,
        createdAt: now(),
      })
      await archiveActiveGoal(ctx)
      return cancelled
    },
  }
}
