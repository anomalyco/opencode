import { describe, it, expect } from "bun:test"
import type { AppState, Message, Tool, Task, UIMode, MessagePart } from "@/cli/ink/state/types"

describe("AppState types", () => {
  it("defines Message structure", () => {
    const message: Message = {
      id: "msg-1",
      role: "assistant",
      parts: [{ type: "text", content: "hello" }],
      complete: false,
    }
    expect(message.id).toBe("msg-1")
  })

  it("defines discriminated MessagePart types", () => {
    const textPart: MessagePart = { type: "text", content: "hello" }
    const reasoningPart: MessagePart = { type: "reasoning", content: "thinking" }
    const toolPart: MessagePart = { type: "tool", content: "executing", toolId: "tool-1" }

    expect(textPart.type).toBe("text")
    expect(reasoningPart.type).toBe("reasoning")
    expect(toolPart.toolId).toBe("tool-1")
  })

  it("defines Tool structure", () => {
    const tool: Tool = {
      id: "tool-1",
      name: "read_file",
      state: "running",
      input: { path: "/test" },
    }
    expect(tool.state).toBe("running")

    const complexTool: Tool = {
      id: "tool-2",
      name: "search",
      state: "running",
      input: {
        query: "test",
        limit: 10,
        recursive: true,
        filter: null,
      },
    }
    expect(complexTool.input.limit).toBe(10)
  })

  it("defines Task structure", () => {
    const task: Task = {
      id: "task-1",
      description: "Research",
      state: "running",
      childTools: new Map(),
    }
    expect(task.state).toBe("running")
  })

  it("defines UIMode enum", () => {
    const modes: UIMode[] = ["input", "select", "navigation"]
    expect(modes).toHaveLength(3)
  })

  it("defines complete AppState", () => {
    const state: AppState = {
      messages: [],
      streaming: {
        text: "",
        tools: new Map(),
        tasks: new Map(),
      },
      session: {
        id: null,
        agent: "build",
        model: null,
      },
      ui: {
        mode: "input",
      },
    }
    expect(state.session.agent).toBe("build")
  })

  it("defines UIState as discriminated union", () => {
    const inputState = { mode: "input" as const }
    const selectState = { mode: "select" as const, selectOptions: [{ label: "A", value: "a" }] as const }
    const navState = { mode: "navigation" as const }

    expect(inputState.mode).toBe("input")
    expect(selectState.selectOptions).toHaveLength(1)
    expect(navState.mode).toBe("navigation")
  })

  it("validates Tool state transitions", () => {
    const { canTransitionTool } = require("@/cli/ink/state/types")

    expect(canTransitionTool("pending", "running")).toBe(true)
    expect(canTransitionTool("running", "completed")).toBe(true)
    expect(canTransitionTool("running", "error")).toBe(true)
    expect(canTransitionTool("error", "running")).toBe(true)

    expect(canTransitionTool("completed", "error")).toBe(false)
    expect(canTransitionTool("completed", "running")).toBe(false)
    expect(canTransitionTool("pending", "completed")).toBe(false)
  })
})
