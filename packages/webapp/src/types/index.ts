// OpenCode API Types

export interface Session {
  id: string
  title: string
  time: {
    created: number
    updated: number
  }
  agent?: string
  model?: {
    providerID: string
    modelID: string
  }
}

export interface Message {
  id: string
  role: "user" | "assistant"
  time: {
    created: number
    updated: number
  }
  parts: MessagePart[]
}

export interface MessagePart {
  id: string
  type: "text" | "tool_call" | "tool_result" | "image" | "thinking"
  text?: string
  tool?: ToolCall
  result?: any
  [key: string]: any
}

export interface ToolCall {
  id: string
  name: string
  parameters: Record<string, any>
}

export interface MessageWithParts {
  info: Message
  parts: MessagePart[]
}

export interface Config {
  directory: string
  state: string
  config: string
  worktree: string
}

export interface Provider {
  id: string
  name: string
  models: Model[]
}

export interface Model {
  id: string
  name: string
  provider: string
}

export interface Agent {
  id: string
  name: string
  description?: string
  system?: string
}

// WebSocket Message Types

export type ClientMessage =
  | {
      type: "subscribe"
      sessionID: string
    }
  | {
      type: "prompt"
      sessionID: string
      content: string
      model?: {
        providerID: string
        modelID: string
      }
      agent?: string
    }
  | {
      type: "ping"
    }

export type ServerMessage =
  | {
      type: "event"
      data: BusEvent
    }
  | {
      type: "subscribed"
      data: {
        sessionID: string
      }
    }
  | {
      type: "pong"
    }
  | {
      type: "error"
      error: string
    }

export interface BusEvent {
  type: string
  properties: Record<string, any>
}

// API Response Types

export interface APIResponse<T> {
  success: boolean
  data: T | null
  errors?: Array<Record<string, any>>
}
