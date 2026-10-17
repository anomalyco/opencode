import type { SessionGoalState } from "@opencode/client/promise"
import { createStore } from "solid-js/store"
import { SessionGoalDock } from "./session-goal-dock"
import type { SessionGoalModel } from "./model"

type Goal = NonNullable<SessionGoalState["goal"]>

const OBJECTIVE = "Ship the goal indicator and todo dock"

function goal(phase: Goal["phase"], overrides: Partial<Goal> = {}): Goal {
  return { id: "goal_story", revision: 1, objective: OBJECTIVE, phase, maxGoalRounds: 8, ...overrides }
}

function state(
  phase: Goal["phase"],
  overrides: Partial<Goal> = {},
  rest: Partial<SessionGoalState> = {},
): SessionGoalState {
  return {
    goal: goal(phase, overrides),
    createdAt: Date.now() - 125_000,
    rounds: 1,
    maxGoalRounds: 8,
    armed: true,
    todo: [],
    ...rest,
  }
}

// The dock's actions are local to the story, so exploring it never reaches a server.
function fixture(initial: SessionGoalState): SessionGoalModel {
  const [store, setStore] = createStore<{ value: SessionGoalState }>({ value: initial })
  const patch = (current: Goal | undefined, next: Partial<Goal>) => (current ? { ...current, ...next } : undefined)

  return {
    state: () => store.value,
    pause: () => {
      setStore("value", "goal", (current) => patch(current, { phase: "paused" }))
      return undefined
    },
    resume: () => {
      setStore("value", "goal", (current) => patch(current, { phase: "active" }))
      return undefined
    },
    edit: (objective: string) => {
      setStore("value", "goal", (current) => patch(current, { objective }))
      return undefined
    },
    clear: () => {
      setStore("value", "goal", undefined)
      return undefined
    },
  }
}

// A component body runs once per mount, so the fixture survives the renderer's re-renders.
function GoalDockStory(props: { initial: SessionGoalState }) {
  const model = fixture(props.initial)

  return <SessionGoalDock model={model} />
}

export default {
  title: "OpenCode/Session/Goal dock",
  id: "app-session-goal-dock",
  component: SessionGoalDock,
}

export const NoGoal = {
  render: () => <GoalDockStory initial={{ rounds: 0, maxGoalRounds: 8, armed: true, todo: [] }} />,
}

export const Active = {
  render: () => <GoalDockStory initial={state("active")} />,
}

export const ActiveStopped = {
  render: () => <GoalDockStory initial={state("active", {}, { armed: false })} />,
}

export const Paused = {
  render: () => <GoalDockStory initial={state("paused")} />,
}

export const Blocked = {
  render: () => (
    <GoalDockStory
      initial={state("blocked", { blockedReason: { code: "max_rounds", message: "Reached the round limit" } })}
    />
  ),
}

export const Complete = {
  render: () => <GoalDockStory initial={state("complete")} />,
}
