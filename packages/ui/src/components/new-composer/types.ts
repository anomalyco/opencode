import type { JSXElement } from "solid-js"

export interface TodoItem {
  content: string
  status: "pending" | "in_progress" | "completed" | "cancelled"
}

export type ComposerMode = "normal" | "shell"
export type ComposerSource = "enter" | "button"

export type AtOption =
  | { type: "agent"; name: string; display: string }
  | { type: "file"; path: string; display: string; recent?: boolean }

export interface SlashCommand {
  id: string
  trigger: string
  title: string
  description?: string
  keybind?: string
  type: "builtin" | "custom"
  source?: "command" | "mcp" | "skill"
}

export interface ImageAttachment {
  id: string
  filename: string
  mime: string
  dataUrl: string
}

export type ComposerPart =
  | { type: "text"; content: string }
  | { type: "file"; path: string; content: string }
  | { type: "agent"; name: string; content: string }

export type ComposerHistoryItem = {
  text: string
  parts?: ComposerPart[]
}

export interface ContextItem {
  id?: string
  path: string
  selection?: { startLine: number; endLine: number }
  comment?: string
  commentID?: string
  commentOrigin?: "review" | "file"
  preview?: string
}

export interface ComposerSubmit {
  source: ComposerSource
  mode: ComposerMode
  text: string
  parts: ComposerPart[]
  files: ImageAttachment[]
  context: ContextItem[]
}

export interface ComposerRuntime {
  submit?: (input: ComposerSubmit) => void | Promise<void>
  abort?: () => void | Promise<void>
  toggleAccept?: () => void | Promise<void>
  openModel?: () => void | Promise<void>
  cycleAgent?: () => void | Promise<void>
  cycleVariant?: () => void | Promise<void>
  runSlash?: (cmd: SlashCommand) => boolean | Promise<boolean>
  historyRead?: (mode: ComposerMode) => Array<string | ComposerHistoryItem>
  historyWrite?: (mode: ComposerMode, list: ComposerHistoryItem[]) => void
  decidePermission?: (response: "once" | "always" | "reject") => void | Promise<void>
  submitQuestion?: (answers: string[][]) => void | Promise<void>
  rejectQuestion?: () => void | Promise<void>
  dialogActive?: () => boolean
  readClipboardImage?: () => Promise<File | null>
  fileRejected?: (input: { source: "paste" | "drop" | "pick"; file?: File }) => void
  searchAt?: (filter: string) => AtOption[] | Promise<AtOption[]>
  searchSlash?: (filter: string) => SlashCommand[] | Promise<SlashCommand[]>
  openContext?: (item: ContextItem) => void
  removeContext?: (item: ContextItem) => void
}

export interface NewComposerProps {
  mode?: "input" | "question" | "permission"
  questionText?: string
  questionOptions?: Array<{ label: string; description?: string }>
  questionMultiple?: boolean
  questionAnswered?: boolean[]
  questionAnswers?: string[][]
  placeholder?: string
  value?: string
  onValueChange?: (value: string) => void
  onSubmit?: (input: ComposerSubmit) => void | Promise<void>
  onAbort?: () => void | Promise<void>
  onAcceptToggle?: () => void | Promise<void>
  dialogActive?: boolean
  readClipboardImage?: () => Promise<File | null>
  onFileRejected?: (input: { source: "paste" | "drop" | "pick"; file?: File }) => void
  onSlashCommand?: (cmd: SlashCommand) => boolean | Promise<boolean>
  historyRead?: (mode: ComposerMode) => Array<string | ComposerHistoryItem>
  historyWrite?: (mode: ComposerMode, list: ComposerHistoryItem[]) => void
  agentName?: string
  modelName?: string
  variant?: string
  agentOptions?: string[]
  modelOptions?: string[]
  variantOptions?: string[]
  agentCurrent?: string
  modelCurrent?: string
  variantCurrent?: string
  onAgentSelect?: (value: string) => void
  onModelSelect?: (value: string) => void
  onVariantSelect?: (value: string) => void
  onModelOpen?: () => void | Promise<void>
  onAgentCycle?: () => void | Promise<void>
  onVariantCycle?: () => void | Promise<void>
  agentKeybind?: string
  modelKeybind?: string
  variantKeybind?: string
  agentControl?: JSXElement
  modelControl?: JSXElement
  variantControl?: JSXElement
  working?: boolean
  accepting?: boolean
  todos?: TodoItem[]
  showTodos?: boolean
  todoCollapsed?: boolean
  onTodoCollapseChange?: (collapsed: boolean) => void
  heightSpring?: { visualDuration: number; bounce: number }
  morphSpring?: { visualDuration: number; bounce: number }
  atOptions?: AtOption[] | ((filter: string) => AtOption[] | Promise<AtOption[]>)
  slashCommands?: SlashCommand[] | ((filter: string) => SlashCommand[] | Promise<SlashCommand[]>)
  questionIndex?: number
  questionTotal?: number
  onQuestionNext?: () => void
  onQuestionBack?: () => void
  onQuestionDismiss?: () => void
  onQuestionSubmit?: (answers: string[][]) => void | Promise<void>
  onQuestionReject?: () => void | Promise<void>
  onQuestionAnswersChange?: (answers: string[][]) => void
  onQuestionJump?: (index: number) => void
  questionBusy?: boolean
  contextItems?: ContextItem[]
  contextActive?: (item: ContextItem) => boolean
  onContextOpen?: (item: ContextItem) => void
  onContextDrop?: (item: ContextItem) => void
  forceDragType?: "image" | "@mention" | null
  permissionTool?: string
  permissionDescription?: string
  permissionPatterns?: string[]
  onPermissionDecide?: (response: "once" | "always" | "reject") => void | Promise<void>
  permissionBusy?: boolean
  runtime?: ComposerRuntime
}

export const ACCEPTED_IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"]
export const ACCEPTED_FILE_TYPES = [...ACCEPTED_IMAGE_TYPES, "application/pdf"]
