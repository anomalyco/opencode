import type { AppState, Message, MessagePart, Tool, UIMode } from "./types"

export type Action =
  | { type: "SET_SESSION"; payload: { id: string; agent: string; model: string | null } }
  | { type: "STREAM_TEXT"; payload: string }
  | {
      type: "TOOL_START"
      payload: { id: string; name: string; input: Record<string, string | number | boolean | null> }
    }
  | { type: "TOOL_END"; payload: { id: string; output?: string; error?: string } }
  | { type: "TASK_START"; payload: { id: string; description: string } }
  | { type: "TASK_END"; payload: { id: string } }
  | { type: "MESSAGE_COMPLETE"; payload: { id: string } }
  | { type: "SET_UI_MODE"; payload: UIMode }
  | { type: "CLEAR_STREAMING" }

export const initialState: AppState = {
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
  ui: { mode: "input" },
}

export function appReducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case "SET_SESSION":
      return {
        ...state,
        session: {
          id: action.payload.id,
          agent: action.payload.agent,
          model: action.payload.model,
        },
      }

    case "STREAM_TEXT":
      return {
        ...state,
        streaming: {
          ...state.streaming,
          text: state.streaming.text + action.payload,
        },
      }

    case "TOOL_START": {
      const tools = new Map(state.streaming.tools)
      tools.set(action.payload.id, {
        id: action.payload.id,
        name: action.payload.name,
        state: "running",
        input: action.payload.input,
      })
      return {
        ...state,
        streaming: { ...state.streaming, tools },
      }
    }

    case "TOOL_END": {
      if (!state.streaming.tools.has(action.payload.id)) {
        return state
      }
      const tools = new Map(state.streaming.tools)
      const tool = tools.get(action.payload.id)!
      tools.set(action.payload.id, {
        ...tool,
        state: action.payload.error ? "error" : "completed",
        output: action.payload.output,
        error: action.payload.error ? action.payload.error : undefined,
      })
      return {
        ...state,
        streaming: { ...state.streaming, tools },
      }
    }

    case "TASK_START": {
      const tasks = new Map(state.streaming.tasks)
      tasks.set(action.payload.id, {
        id: action.payload.id,
        description: action.payload.description,
        state: "running",
        childTools: new Map(),
      })
      return {
        ...state,
        streaming: { ...state.streaming, tasks },
      }
    }

    case "TASK_END": {
      if (!state.streaming.tasks.has(action.payload.id)) {
        return state
      }
      const tasks = new Map(state.streaming.tasks)
      const task = tasks.get(action.payload.id)!
      tasks.set(action.payload.id, {
        ...task,
        state: "completed",
      })
      return {
        ...state,
        streaming: { ...state.streaming, tasks },
      }
    }

    case "MESSAGE_COMPLETE": {
      const toolsSnapshot = Array.from(state.streaming.tools.values())
      const tasksSnapshot = Array.from(state.streaming.tasks.values())

      const hasRunningTasks = tasksSnapshot.some((t) => t.state === "running")
      const hasRunningTools = toolsSnapshot.some((t) => t.state === "running")
      if (hasRunningTasks || hasRunningTools) {
        return state
      }

      const text = state.streaming.text
      if (text.length === 0 && toolsSnapshot.length === 0) {
        return state
      }

      const parts: MessagePart[] = []
      if (text.length > 0) {
        parts.push({ type: "text", content: text })
      }
      for (const tool of toolsSnapshot) {
        if (tool.state === "completed" || tool.state === "error") {
          parts.push({
            type: "tool",
            content: tool.output || "",
            toolId: tool.id,
          })
        }
      }

      const message: Message = {
        id: action.payload.id,
        role: "assistant",
        parts,
        complete: true,
      }
      return {
        ...state,
        messages: [...state.messages, message],
        streaming: {
          text: "",
          tools: new Map(),
          tasks: new Map(),
        },
      }
    }

    case "SET_UI_MODE":
      if (action.payload === "input") {
        return { ...state, ui: { mode: "input" } }
      }
      if (action.payload === "navigation") {
        return { ...state, ui: { mode: "navigation" } }
      }
      if (action.payload === "select") {
        if ("selectOptions" in state.ui) {
          return { ...state, ui: { mode: "select", selectOptions: state.ui.selectOptions } }
        }
        return { ...state, ui: { mode: "select", selectOptions: [] } }
      }
      return state

    case "CLEAR_STREAMING":
      return {
        ...state,
        streaming: {
          text: "",
          tools: new Map(),
          tasks: new Map(),
        },
      }

    default:
      return state
  }
}
