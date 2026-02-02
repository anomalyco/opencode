import { describe, it, expect } from "bun:test"
import { appReducer, initialState, type Action } from "@/cli/ink/state/reducer"

describe("appReducer", () => {
  it("returns initial state", () => {
    expect(initialState.messages).toEqual([])
    expect(initialState.session.agent).toBe("build")
    expect(initialState.ui.mode).toBe("input")
  })

  describe("SET_SESSION", () => {
    it("updates session info", () => {
      const action: Action = {
        type: "SET_SESSION",
        payload: { id: "sess-1", agent: "plan", model: "claude-3" },
      }
      const state = appReducer(initialState, action)
      expect(state.session.id).toBe("sess-1")
      expect(state.session.agent).toBe("plan")
      expect(state.session.model).toBe("claude-3")
    })
  })

  describe("STREAM_TEXT", () => {
    it("appends text to streaming", () => {
      const action: Action = { type: "STREAM_TEXT", payload: "Hello" }
      const state = appReducer(initialState, action)
      expect(state.streaming.text).toBe("Hello")
    })

    it("accumulates text", () => {
      let state = appReducer(initialState, { type: "STREAM_TEXT", payload: "Hello" })
      state = appReducer(state, { type: "STREAM_TEXT", payload: " World" })
      expect(state.streaming.text).toBe("Hello World")
    })
  })

  describe("TOOL_START", () => {
    it("adds tool to active set", () => {
      const action: Action = {
        type: "TOOL_START",
        payload: { id: "tool-1", name: "read_file", input: { path: "/test" } },
      }
      const state = appReducer(initialState, action)
      expect(state.streaming.tools.has("tool-1")).toBe(true)
      expect(state.streaming.tools.get("tool-1")?.state).toBe("running")
    })
  })

  describe("TOOL_END", () => {
    it("marks tool as completed", () => {
      let state = appReducer(initialState, {
        type: "TOOL_START",
        payload: { id: "tool-1", name: "read_file", input: {} },
      })
      state = appReducer(state, {
        type: "TOOL_END",
        payload: { id: "tool-1", output: "file contents" },
      })
      expect(state.streaming.tools.get("tool-1")?.state).toBe("completed")
      expect(state.streaming.tools.get("tool-1")?.output).toBe("file contents")
    })
  })

  describe("MESSAGE_COMPLETE", () => {
    it("moves streaming content to messages", () => {
      let state = appReducer(initialState, { type: "STREAM_TEXT", payload: "Response" })
      state = appReducer(state, { type: "MESSAGE_COMPLETE", payload: { id: "msg-1" } })
      expect(state.messages).toHaveLength(1)
      expect(state.messages[0]?.id).toBe("msg-1")
      expect(state.streaming.text).toBe("")
    })
  })

  describe("SET_UI_MODE", () => {
    it("changes UI mode", () => {
      const action: Action = { type: "SET_UI_MODE", payload: "select" }
      const state = appReducer(initialState, action)
      expect(state.ui.mode).toBe("select")
    })
  })

  describe("TASK_START", () => {
    it("adds task to active set", () => {
      const action: Action = {
        type: "TASK_START",
        payload: { id: "task-1", description: "Build project" },
      }
      const state = appReducer(initialState, action)
      expect(state.streaming.tasks.has("task-1")).toBe(true)
      expect(state.streaming.tasks.get("task-1")?.state).toBe("running")
    })
  })

  describe("TASK_END", () => {
    it("marks task as completed", () => {
      let state = appReducer(initialState, {
        type: "TASK_START",
        payload: { id: "task-1", description: "Build project" },
      })
      state = appReducer(state, {
        type: "TASK_END",
        payload: { id: "task-1" },
      })
      expect(state.streaming.tasks.get("task-1")?.state).toBe("completed")
    })

    it("ignores non-existent task", () => {
      const state = appReducer(initialState, {
        type: "TASK_END",
        payload: { id: "non-existent" },
      })
      expect(state.streaming.tasks.size).toBe(0)
    })
  })

  describe("MESSAGE_COMPLETE", () => {
    it("moves streaming content to messages", () => {
      let state = appReducer(initialState, { type: "STREAM_TEXT", payload: "Response" })
      state = appReducer(state, { type: "MESSAGE_COMPLETE", payload: { id: "msg-1" } })
      expect(state.messages).toHaveLength(1)
      expect(state.messages[0]?.id).toBe("msg-1")
      expect(state.streaming.text).toBe("")
    })

    it("preserves tool outputs in message parts", () => {
      let state = appReducer(initialState, { type: "STREAM_TEXT", payload: "Response" })
      state = appReducer(state, {
        type: "TOOL_START",
        payload: { id: "tool-1", name: "read", input: { path: "/test" } },
      })
      state = appReducer(state, {
        type: "TOOL_END",
        payload: { id: "tool-1", output: "file contents" },
      })
      state = appReducer(state, { type: "MESSAGE_COMPLETE", payload: { id: "msg-1" } })

      const messageParts = state.messages[0]?.parts
      expect(messageParts).toHaveLength(2)
      expect(messageParts?.[0]?.type).toBe("text")
      const secondPart = messageParts?.[1]
      if (secondPart?.type === "tool") {
        expect(secondPart.toolId).toBe("tool-1")
      }
    })

    it("creates message without text part when only tools exist", () => {
      let state = appReducer(initialState, {
        type: "TOOL_START",
        payload: { id: "tool-1", name: "read", input: {} },
      })
      state = appReducer(state, {
        type: "TOOL_END",
        payload: { id: "tool-1", output: "file contents" },
      })
      state = appReducer(state, { type: "MESSAGE_COMPLETE", payload: { id: "msg-1" } })

      const messageParts = state.messages[0]?.parts
      expect(messageParts).toHaveLength(1)
      expect(messageParts?.[0]?.type).toBe("tool")
    })

    it("prevents completion with running tools", () => {
      let state = appReducer(initialState, {
        type: "TOOL_START",
        payload: { id: "tool-1", name: "read", input: {} },
      })
      state = appReducer(state, { type: "MESSAGE_COMPLETE", payload: { id: "msg-1" } })
      expect(state.messages).toHaveLength(0)
    })

    it("prevents completion with running tasks", () => {
      let state = appReducer(initialState, {
        type: "TASK_START",
        payload: { id: "task-1", description: "Build" },
      })
      state = appReducer(state, { type: "MESSAGE_COMPLETE", payload: { id: "msg-1" } })
      expect(state.messages).toHaveLength(0)
    })

    it("prevents completion when some tools completed but one still running", () => {
      let state = appReducer(initialState, {
        type: "TOOL_START",
        payload: { id: "tool-1", name: "read", input: {} },
      })
      state = appReducer(state, {
        type: "TOOL_END",
        payload: { id: "tool-1", output: "success" },
      })
      state = appReducer(state, {
        type: "TOOL_START",
        payload: { id: "tool-2", name: "write", input: {} },
      })
      state = appReducer(state, { type: "MESSAGE_COMPLETE", payload: { id: "msg-1" } })
      expect(state.messages).toHaveLength(0)
    })

    it("includes completed and error tools in message", () => {
      let state = appReducer(initialState, { type: "STREAM_TEXT", payload: "Response" })
      state = appReducer(state, {
        type: "TOOL_START",
        payload: { id: "tool-1", name: "read", input: {} },
      })
      state = appReducer(state, {
        type: "TOOL_END",
        payload: { id: "tool-1", output: "read success" },
      })
      state = appReducer(state, {
        type: "TOOL_START",
        payload: { id: "tool-2", name: "write", input: {} },
      })
      state = appReducer(state, {
        type: "TOOL_END",
        payload: { id: "tool-2", error: "write failed" },
      })
      state = appReducer(state, { type: "MESSAGE_COMPLETE", payload: { id: "msg-1" } })

      const messageParts = state.messages[0]?.parts
      expect(messageParts).toHaveLength(3)
      expect(messageParts?.[0]?.type).toBe("text")
      const secondPart = messageParts?.[1]
      if (secondPart?.type === "tool") {
        expect(secondPart.toolId).toBe("tool-1")
      }
      const thirdPart = messageParts?.[2]
      if (thirdPart?.type === "tool") {
        expect(thirdPart.toolId).toBe("tool-2")
      }
    })

    it("handles tool retry (error → running → completed) in MESSAGE_COMPLETE", () => {
      let state = appReducer(initialState, {
        type: "TOOL_START",
        payload: { id: "tool-1", name: "read", input: {} },
      })
      state = appReducer(state, {
        type: "TOOL_END",
        payload: { id: "tool-1", error: "failed" },
      })
      state = appReducer(state, {
        type: "TOOL_START",
        payload: { id: "tool-1", name: "read", input: {} },
      })
      state = appReducer(state, {
        type: "TOOL_END",
        payload: { id: "tool-1", output: "success on retry" },
      })
      state = appReducer(state, { type: "MESSAGE_COMPLETE", payload: { id: "msg-1" } })

      const messageParts = state.messages[0]?.parts
      expect(messageParts).toHaveLength(1)
      const toolPart = messageParts?.find((p) => p.type === "tool")
      if (toolPart?.type === "tool") {
        expect(toolPart.content).toBe("success on retry")
      }
    })

    it("prevents completion with empty text and no tools", () => {
      const state = appReducer(initialState, { type: "MESSAGE_COMPLETE", payload: { id: "msg-1" } })
      expect(state.messages).toHaveLength(0)
    })

    it("prevents completion with pending tools", () => {
      let state = appReducer(initialState, { type: "STREAM_TEXT", payload: "Response" })
      state = appReducer(state, {
        type: "TOOL_START",
        payload: { id: "tool-1", name: "read", input: {} },
      })
      state = appReducer(state, { type: "MESSAGE_COMPLETE", payload: { id: "msg-1" } })

      expect(state.messages).toHaveLength(0)
    })
  })

  describe("TOOL_START edge cases", () => {
    it("overwrites existing tool with same ID", () => {
      let state = appReducer(initialState, {
        type: "TOOL_START",
        payload: { id: "tool-1", name: "read", input: {} },
      })
      state = appReducer(state, {
        type: "TOOL_START",
        payload: { id: "tool-1", name: "write", input: {} },
      })
      expect(state.streaming.tools.get("tool-1")?.name).toBe("write")
    })
  })

  describe("TOOL_END edge cases", () => {
    it("ignores non-existent tool", () => {
      const state = appReducer(initialState, {
        type: "TOOL_END",
        payload: { id: "non-existent", output: "result" },
      })
      expect(state.streaming.tools.size).toBe(0)
    })

    it("clears error field on success", () => {
      let state = appReducer(initialState, {
        type: "TOOL_START",
        payload: { id: "tool-1", name: "read", input: {} },
      })
      state = appReducer(state, {
        type: "TOOL_END",
        payload: { id: "tool-1", error: "failed" },
      })
      expect(state.streaming.tools.get("tool-1")?.error).toBe("failed")

      state = appReducer(state, {
        type: "TOOL_START",
        payload: { id: "tool-1", name: "read", input: {} },
      })
      state = appReducer(state, {
        type: "TOOL_END",
        payload: { id: "tool-1", output: "success" },
      })
      expect(state.streaming.tools.get("tool-1")?.error).toBeUndefined()
    })
  })

  describe("STREAM_TEXT edge cases", () => {
    it("accumulates multiple text chunks", () => {
      let state = initialState
      state = appReducer(state, { type: "STREAM_TEXT", payload: "1" })
      state = appReducer(state, { type: "STREAM_TEXT", payload: "2" })
      state = appReducer(state, { type: "STREAM_TEXT", payload: "3" })
      expect(state.streaming.text).toBe("123")
    })
  })

  describe("CLEAR_STREAMING", () => {
    it("resets all streaming state", () => {
      let state = initialState
      state = appReducer(state, { type: "STREAM_TEXT", payload: "text" })
      state = appReducer(state, {
        type: "TOOL_START",
        payload: { id: "tool-1", name: "read", input: {} },
      })
      state = appReducer(state, {
        type: "TASK_START",
        payload: { id: "task-1", description: "Build" },
      })

      state = appReducer(state, { type: "CLEAR_STREAMING" })

      expect(state.streaming.text).toBe("")
      expect(state.streaming.tools.size).toBe(0)
      expect(state.streaming.tasks.size).toBe(0)
    })
  })
})
