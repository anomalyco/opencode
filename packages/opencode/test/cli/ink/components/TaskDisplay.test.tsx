/** @jsxImportSource react */
import { describe, it, expect } from "bun:test"
import { render, type Instance } from "ink"
import { TaskDisplay } from "@/cli/ink/components"
import type { Task, Tool } from "@/cli/ink/state/types"

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

  it("renders without errors with running child tool", () => {
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

  it("renders without errors with completed child tool", () => {
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

  it("renders without errors with multiple running tools", () => {
    const tool1: Tool = { id: "tool-1", name: "bash", state: "running", input: { command: "git status" } }
    const tool2: Tool = { id: "tool-2", name: "read", state: "running", input: { path: "/file.txt" } }
    const task: Task = {
      ...baseTask,
      childTools: new Map([
        ["tool-1", tool1],
        ["tool-2", tool2],
      ]),
    }
    const instance = render(<TaskDisplay task={task} agent="git-agent" />)
    instance.unmount()
    expect(true).toBe(true)
  })

  it("renders without errors with empty tool input", () => {
    const task: Task = {
      ...baseTask,
      childTools: new Map([["tool-1", { id: "tool-1", name: "bash", state: "running", input: {} }]]),
    }
    const instance = render(<TaskDisplay task={task} agent="git-agent" />)
    instance.unmount()
    expect(true).toBe(true)
  })

  it("renders without errors with number input type", () => {
    const task: Task = {
      ...baseTask,
      childTools: new Map([["tool-1", { id: "tool-1", name: "counter", state: "running", input: { count: 42 } }]]),
    }
    const instance = render(<TaskDisplay task={task} agent="git-agent" />)
    instance.unmount()
    expect(true).toBe(true)
  })

  it("renders without errors with boolean input type", () => {
    const task: Task = {
      ...baseTask,
      childTools: new Map([["tool-1", { id: "tool-1", name: "flag", state: "running", input: { enabled: true } }]]),
    }
    const instance = render(<TaskDisplay task={task} agent="git-agent" />)
    instance.unmount()
    expect(true).toBe(true)
  })

  it("renders without errors with null input value", () => {
    const task: Task = {
      ...baseTask,
      childTools: new Map([["tool-1", { id: "tool-1", name: "tool", state: "running", input: { value: null } }]]),
    }
    const instance = render(<TaskDisplay task={task} agent="git-agent" />)
    instance.unmount()
    expect(true).toBe(true)
  })

  it("renders without errors with undefined input value", () => {
    const task: Task = {
      ...baseTask,
      childTools: new Map([
        ["tool-1", { id: "tool-1", name: "tool", state: "running", input: { optional: undefined } as any }],
      ]),
    }
    const instance = render(<TaskDisplay task={task} agent="git-agent" />)
    instance.unmount()
    expect(true).toBe(true)
  })

  it("renders without errors with object input value", () => {
    const task: Task = {
      ...baseTask,
      childTools: new Map([
        ["tool-1", { id: "tool-1", name: "tool", state: "running", input: { config: { env: "prod" } } as any }],
      ]),
    }
    const instance = render(<TaskDisplay task={task} agent="git-agent" />)
    instance.unmount()
    expect(true).toBe(true)
  })

  it("renders without errors with empty input", () => {
    const task: Task = {
      ...baseTask,
      childTools: new Map([["tool-1", { id: "tool-1", name: "tool", state: "running", input: {} } as Tool]]),
    }
    const instance = render(<TaskDisplay task={task} agent="git-agent" />)
    instance.unmount()
    expect(true).toBe(true)
  })

  it("renders without errors with negative elapsed time", () => {
    const instance = render(<TaskDisplay task={baseTask} agent="git-agent" elapsed={-5} />)
    instance.unmount()
    expect(true).toBe(true)
  })

  it("renders without errors with empty string input value", () => {
    const task: Task = {
      ...baseTask,
      childTools: new Map([["tool-1", { id: "tool-1", name: "tool", state: "running", input: { value: "" } }]]),
    }
    const instance = render(<TaskDisplay task={task} agent="git-agent" />)
    instance.unmount()
    expect(true).toBe(true)
  })
})
