import type { SessionGoalState } from "@opencode/client/promise"
import { createStore } from "solid-js/store"
import { SessionGoalDock } from "./session-goal-dock"
import type { SessionGoalModel } from "./model"

type Goal = NonNullable<SessionGoalState["goal"]>

const OBJECTIVE = "Ship the goal indicator and todo dock"

const TODOS: SessionGoalState["todo"] = [
  { position: 0, content: "Wire the goal store", status: "completed" },
  { position: 1, content: "Render the todo list", status: "in_progress" },
  { position: 2, content: "Ship the PR", status: "pending" },
  { position: 3, content: "Write the changelog", status: "cancelled" },
]

const MANY_TODOS: SessionGoalState["todo"] = Array.from({ length: 7 }, (_, index) => ({
  position: index,
  content: `Todo item ${index + 1}`,
  status: index === 0 ? "in_progress" : "pending",
}))

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
function fixture(initial: SessionGoalState, options: { interrupted?: boolean } = {}): SessionGoalModel {
  const [store, setStore] = createStore<{ value: SessionGoalState }>({ value: initial })
  const patch = (current: Goal | undefined, next: Partial<Goal>) => (current ? { ...current, ...next } : undefined)

  return {
    state: () => store.value,
    interrupted: () => options.interrupted ?? false,
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
function GoalDockStory(props: {
  initial: SessionGoalState
  options?: { interrupted?: boolean }
}) {
  const model = fixture(props.initial, props.options)

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

export const ActiveInterrupted = {
  render: () => <GoalDockStory initial={state("active", {}, { armed: false })} options={{ interrupted: true }} />,
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

export const ActiveLongRunning = {
  render: () => (
    <GoalDockStory initial={state("active", {}, { createdAt: Date.now() - 95 * 60_000 - 3_000 })} />
  ),
}

export const Todos = {
  render: () => <GoalDockStory initial={state("active", {}, { todo: TODOS })} />,
}

export const TodosOverflow = {
  render: () => <GoalDockStory initial={state("active", {}, { todo: MANY_TODOS })} />,
}
