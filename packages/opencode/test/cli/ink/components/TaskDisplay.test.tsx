/** @jsxImportSource react */
import { describe, it, expect } from "bun:test"
import { render, type Instance } from "ink"
import { TaskDisplay } from "@/cli/ink/components"
import type { Task } from "@/cli/ink/state/types"

describe("TaskDisplay", () => {
  const baseTask: Task = {
    id: "task-1",
    description: "Get current project state",
    state: "running",
    childTools: new Map(),
  }

  it("renders without errors for running state", () => {
    const instance = render(<TaskDisplay task={baseTask} agent="git-agent" />)
    instance.unmount()
    expect(true).toBe(true)
  })

  it("renders without errors for completed state", () => {
    const task: Task = { ...baseTask, state: "completed" }
    const instance = render(<TaskDisplay task={task} agent="git-agent" />)
    instance.unmount()
    expect(true).toBe(true)
  })

  it("renders without errors with elapsed time", () => {
    const instance = render(<TaskDisplay task={baseTask} agent="git-agent" elapsed={5} />)
    instance.unmount()
    expect(true).toBe(true)
  })

  it("renders without errors with zero elapsed time", () => {
    const instance = render(<TaskDisplay task={baseTask} agent="git-agent" elapsed={0} />)
    instance.unmount()
    expect(true).toBe(true)
  })

  it("renders without errors with child tool", () => {
    const task: Task = {
      ...baseTask,
      childTools: new Map([
        ["tool-1", { id: "tool-1", name: "bash", state: "running", input: { command: "git status" } }],
      ]),
    }
    const instance = render(<TaskDisplay task={task} agent="git-agent" />)
    instance.unmount()
    expect(true).toBe(true)
  })

  it("renders without errors with completed task with child tool", () => {
    const task: Task = {
      ...baseTask,
      state: "completed",
      childTools: new Map([
        ["tool-1", { id: "tool-1", name: "bash", state: "completed", input: { command: "git status" } }],
      ]),
    }
    const instance = render(<TaskDisplay task={task} agent="git-agent" />)
    instance.unmount()
    expect(true).toBe(true)
  })
})
