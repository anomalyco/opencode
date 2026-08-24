import type { AgentPart, ComposerStore, FileAttachmentPart, ImageAttachmentPart, Prompt, SkillPart } from "./state"

export type ComposerFilePart = FileAttachmentPart
export type ComposerAgentPart = AgentPart
export type ComposerSkillPart = SkillPart
export type ComposerAttachment = ImageAttachmentPart
export type ComposerPrompt = Prompt
export type ComposerComment = ComposerStore["context"]["items"][number]
export type ComposerPersistedState = ComposerStore

export type ComposerHistoryEntry = {
  prompt: ComposerPrompt
  metadata?: unknown
}

export type ComposerHistory = {
  entries: (mode: "normal" | "shell") => ComposerHistoryEntry[]
  add: (prompt: ComposerPrompt, mode: "normal" | "shell") => void
  capture?: () => unknown
  restore?: (metadata: unknown) => void
}

export type ComposerOption = {
  id: string
  label: string
  providerID?: string
}

export type ComposerSuggestion = {
  id: string
  kind: "agent" | "command" | "file" | "reference" | "resource" | "skill"
  label: string
  title?: string
  trigger?: string
  description?: string
  path?: string
  keybind?: string[]
  recent?: boolean
  mention?: ComposerFilePart | ComposerAgentPart | ComposerSkillPart
}
