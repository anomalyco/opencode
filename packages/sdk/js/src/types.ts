export interface ChatMessageTextPart {
  type: "text"
  text: string
  providerMetadata?: Record<string, unknown>
}

export interface ChatMessageFilePart {
  type: "file"
  url: string
  mediaType: string
  filename?: string
}

export interface ChatMessageStepStartPart {
  type: "step-start"
}

export interface ChatMessageToolPart {
  type: "tool"
  toolName: string
  toolCallId: string
  state: "completed" | "error"
  input: Record<string, unknown>
  output?: string
  error?: string
  compacted?: boolean
  callProviderMetadata?: Record<string, unknown>
  attachments?: ChatMessageFilePart[]
}

export interface ChatMessageReasoningPart {
  type: "reasoning"
  text: string
  providerMetadata?: Record<string, unknown>
}

export type ChatMessagePart =
  | ChatMessageTextPart
  | ChatMessageFilePart
  | ChatMessageStepStartPart
  | ChatMessageToolPart
  | ChatMessageReasoningPart

export interface ChatMessage {
  id: string
  role: "user" | "assistant"
  parts: ChatMessagePart[]
  altered?: boolean
}
