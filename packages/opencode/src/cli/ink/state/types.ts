export type ToolState = "pending" | "running" | "completed" | "error"
export type TaskState = "running" | "completed"
export type UIMode = "input" | "select" | "navigation"
export type MessageRole = "user" | "assistant"

export function canTransitionTool(from: ToolState, to: ToolState): boolean {
  const validTransitions: Record<ToolState, ToolState[]> = {
    pending: ["running", "error"],
    running: ["completed", "error"],
    completed: [],
    error: ["running"],
  }
  return validTransitions[from].includes(to)
}

export function canTransitionTask(from: TaskState, to: TaskState): boolean {
  const validTransitions: Record<TaskState, TaskState[]> = {
    running: ["completed"],
    completed: [],
  }
  return validTransitions[from].includes(to)
}

export type MessagePart =
  | { type: "text"; content: string }
  | { type: "reasoning"; content: string }
  | { type: "tool"; content: string; toolId: string }

export interface Message {
  id: string
  role: MessageRole
  parts: MessagePart[]
  complete: boolean
}

export interface Tool {
  id: string
  name: string
  state: ToolState
  input: Record<string, string | number | boolean | null>
  output?: string
  error?: string
}

export interface Task {
  id: string
  description: string
  state: TaskState
  childTools: Map<string, Tool>
}

export interface StreamingState {
  text: string
  tools: Map<string, Tool>
  tasks: Map<string, Task>
}

export interface SessionState {
  id: string | null
  agent: string
  model: string | null
}

export interface SelectOption {
  label: string
  value: string
}

export type UIState =
  | { mode: "input" }
  | { mode: "select"; selectOptions: readonly SelectOption[] }
  | { mode: "navigation" }

export interface AppState {
  readonly messages: readonly Message[]
  streaming: {
    readonly text: string
    readonly tools: ReadonlyMap<string, Tool>
    readonly tasks: ReadonlyMap<string, Task>
  }
  session: SessionState
  ui: UIState
}
