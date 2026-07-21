import type { FilePartSource } from "@opencode-ai/sdk/v2/client"

type PromptInputV2PartBase = {
  content: string
  start: number
  end: number
}

export type PromptInputV2TextPart = PromptInputV2PartBase & {
  type: "text"
}

export type PromptInputV2FilePart = PromptInputV2PartBase & {
  type: "file"
  path: string
  selection?: PromptInputV2Selection
  mime?: string
  filename?: string
  url?: string
  source?: FilePartSource
}

export type PromptInputV2AgentPart = PromptInputV2PartBase & {
  type: "agent"
  name: string
}

export type PromptInputV2Attachment = {
  type: "image"
  id: string
  filename: string
  sourcePath?: string
  mime: string
  dataUrl: string
}

export type PromptInputV2Prompt = (
  | PromptInputV2TextPart
  | PromptInputV2FilePart
  | PromptInputV2AgentPart
  | PromptInputV2Attachment
)[]

export type PromptInputV2Model = {
  providerID: string
  modelID: string
  variant?: string | null
}

export type PromptInputV2Selection = {
  startLine: number
  startChar: number
  endLine: number
  endChar: number
}

export type PromptInputV2Comment = {
  type: "file"
  key: string
  path: string
  selection?: PromptInputV2Selection
  comment?: string
  commentID?: string
  commentOrigin?: "review" | "file"
  preview?: string
}

export type PromptInputV2PersistedState = {
  prompt: PromptInputV2Prompt
  cursor?: number
  model?: PromptInputV2Model
  context: {
    items: PromptInputV2Comment[]
  }
}

export type PromptInputV2HistoryEntry = {
  prompt: PromptInputV2Prompt
  metadata?: unknown
}

export type PromptInputV2History = {
  entries: (mode: "normal" | "shell") => PromptInputV2HistoryEntry[]
  add: (prompt: PromptInputV2Prompt, mode: "normal" | "shell") => void
  capture?: () => unknown
  restore?: (metadata: unknown) => void
}

export type PromptInputV2Option = {
  id: string
  label: string
  providerID?: string
}

export type PromptInputV2Suggestion = {
  id: string
  kind: "agent" | "command" | "file" | "reference" | "resource"
  label: string
  title?: string
  trigger?: string
  description?: string
  path?: string
  keybind?: string[]
  recent?: boolean
  mention?: PromptInputV2FilePart | PromptInputV2AgentPart
}
