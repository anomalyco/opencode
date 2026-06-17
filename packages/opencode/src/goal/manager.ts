import { ActiveGoalExistsError } from "./errors"
import { createGoalCheckpoint } from "./checkpoints"
import { appendGoalEvent } from "./events"
import { renderGoalStatus, renderNoActiveGoal } from "./renderer"
import { archiveActiveGoal, loadActiveGoal, saveActiveGoal, type ActiveGoalState } from "./store"
import { transitionGoal } from "./state-machine"
import type { Goal, GoalEvent } from "./types"
import type { InstanceContext } from "@/project/instance-context"

export interface GoalStatusResult {
  active: ActiveGoalState | null
  output: string
}

export interface GoalManager {
  init(): Promise<ActiveGoalState | null>
  create(objective: string): Promise<Goal>
  status(): Promise<GoalStatusResult>
  clear(): Promise<Goal>
}

export interface GoalManagerOptions {
  now?: () => string
  id?: () => string
  eventId?: () => string
  checkpointId?: () => string
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
      await saveActiveGoal(ctx, { goal: created })
      await event(created, "GOAL_CREATED", "Goal created")
      return created
    },

    async status() {
      const active = await loadActiveGoal(ctx)
      return {
        active,
        output: active ? renderGoalStatus(active) : renderNoActiveGoal(),
      }
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
