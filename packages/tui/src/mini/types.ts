import type { Agent } from "@opencode/schema/agent"
import type { Model } from "@opencode/schema/model"
import type { Provider } from "@opencode/schema/provider"
import type { Skill } from "@opencode/schema/skill"
import type { Form } from "@opencode/schema/form"
import type { SessionMessage } from "@opencode/schema/session-message"
import type { Session } from "@opencode/schema/session"
// Shared type vocabulary for the direct interactive mode (`opencode mini`).
//
// Direct mode uses a split-footer terminal layout: immutable scrollback for the
// session transcript, and a mutable footer for prompt input, status, and
// permission/form UI. Every module in run/* shares these types to stay
// aligned on that two-lane model.
//
// Data flow through the system:
//
//   V2 events / demo actions → StreamCommit[] + FooterEvent[]
//     → stream.ts bridges to footer API
//       → footer.ts queues commits and patches the footer view
//         → OpenTUI split-footer renderer writes to terminal
import type {
  FormAnswer,
  FormInfo,
  OpenCodeClient,
  LocationGetOutput,
  LocationRef,
  PermissionRequest,
  ReferenceListOutput,
  SessionMessageAssistantTool,
} from "@opencode/client/promise"
import type { Config } from "../config"
import type { CliRenderer } from "@opentui/core"
import type { SessionInbox } from "@opencode/schema/session-inbox"

export type RunFilePart = {
  type: "file"
  url: string
  filename: string
  mime: string
}

type PromptModel = { providerID: Provider.ID; modelID: Model.ID }

export type RunPromptPart =
  | {
      type: "file"
      url: string
      filename?: string
      mime?: string
      description?: string
      source?: {
        type: string
        text: { start: number; end: number; value: string }
        [key: string]: unknown
      }
    }
  | { type: "agent"; name: string; source?: { start: number; end: number; value: string } }
  | { type: "skill"; id: Skill.ID; source?: { start: number; end: number; value: string } }

export type RunCommand = {
  name: string
  description?: string
  source?: string
}

type RunProviderModel = {
  name?: string
  cost?: {
    input: number
  }
  limit?: {
    context: number
  }
  status?: string
  variants?: Record<string, unknown>
}

export type RunProvider = {
  id: Provider.ID
  name: string
  models: Record<string, RunProviderModel>
}

export type RunDelivery = SessionInbox.Delivery

export type RunPrompt = {
  messageID?: SessionMessage.ID
  text: string
  parts: RunPromptPart[]
  delivery?: RunDelivery
  mode?: "shell"
  command?: {
    name: string
    arguments: string
    source?: string
  }
}

export type FooterQueuedPrompt = {
  messageID: SessionMessage.ID
  prompt: RunPrompt
  delivery: RunDelivery
  skills?: ReadonlyArray<{ id: Skill.ID; name: string }>
}

export type QueuedPromptAction = "steer" | "queue" | "cancel"

export type RunAgent = {
  id: Agent.ID
  name: string
  description?: string
  mode: "subagent" | "primary" | "all"
  hidden: boolean
}

export type RunReference = ReferenceListOutput["data"][number]

export type RunInput = {
  sdk: OpenCodeClient
  location: LocationGetOutput
  agent: Agent.ID | undefined
  model: PromptModel | undefined
  variant: Model.VariantID | undefined
  files: RunFilePart[]
  demo?: boolean
}

export type MiniHost = {
  version: string
  terminal: {
    stdin: NodeJS.ReadStream
  }
  platform: NodeJS.Platform
  stdout: {
    write(value: string): void
  }
  files: {
    readText(url: string): Promise<string>
  }
  editor: {
    open(input: {
      value: string
      cwd: string
      renderer: CliRenderer
      stdin: NodeJS.ReadStream
    }): Promise<string | undefined>
  }
  paths: {
    home: string
  }
  signals: {
    sigint: {
      subscribe(listener: () => void): () => void
    }
    sigusr2: {
      subscribe(listener: () => void): () => void
    }
  }
  startup: {
    showTiming: boolean
    now(): number
  }
  diagnostics: {
    trace?: {
      write(type: string, data?: unknown): void
    }
  }
  preferences: {
    resolveVariant(model: RunInput["model"]): Promise<string | undefined>
    saveVariant(model: RunInput["model"], variant: Model.VariantID | undefined): Promise<void>
  }
}

// The semantic role of a scrollback entry. Maps 1:1 to theme colors.
export type EntryKind = "system" | "user" | "assistant" | "reasoning" | "tool" | "error"

// Whether the assistant is actively processing a turn.
type FooterPhase = "idle" | "running"

// Full snapshot of footer status bar state. Every update replaces the whole
// object in the SolidJS signal so the view re-renders atomically.
export type FooterState = {
  phase: FooterPhase
  status: string
  notice: string
  model: string
  usage: { tokens: number; percent?: number; cost?: number } | undefined
  first: boolean
  interrupt: number
  exit: number
}

// A partial update to FooterState. The footer merges this onto the current state.
export type FooterPatch = Partial<FooterState>

export type TurnSummary = {
  agent: string
  model: string
  duration: string
}

export type ScrollbackOptions = {
  suppressBackgrounds?: boolean
  shellOutput?: boolean
  mono?: boolean
}

type ToolCodeSnapshot = {
  kind: "code"
  title: string
  content: string
  file?: string
}

type ToolDiffSnapshot = {
  kind: "diff"
  items: Array<{
    title: string
    diff: string
    file?: string
    deletions?: number
  }>
}

type ToolTaskSnapshot = {
  kind: "task"
  title: string
  rows: string[]
  tail: string
}

type ToolQuestionSnapshot = {
  kind: "question"
  items: Array<{
    question: string
    answer: string
  }>
  tail: string
}

export type ToolSnapshot = ToolCodeSnapshot | ToolDiffSnapshot | ToolTaskSnapshot | ToolQuestionSnapshot

type MiniToolState =
  | {
      status: "completed"
      input: Record<string, unknown>
      output: string
      title?: string
      metadata?: Record<string, unknown>
      time: { start: number; end: number }
    }
  | {
      status: "error"
      input: Record<string, unknown>
      error: string
      metadata?: Record<string, unknown>
      time: { start: number; end: number }
    }

// Retained only for the noninteractive run JSON/V1 compatibility boundary.
// Interactive Mini commits carry SessionMessageAssistantTool directly.
export type MiniToolPart = {
  partID: string
  sessionID: Session.ID
  messageID: SessionMessage.ID
  type?: "tool"
  id: string
  tool: string
  state: MiniToolState
}

export type MiniPermissionRequest = PermissionRequest & {
  tool?: SessionMessageAssistantTool
}

export type MiniFormRequest = FormInfo & {
  location?: LocationRef
}

export type EntryLayout = "inline" | "block"

export type RunEntryBody =
  | { type: "none" }
  | { type: "text"; content: string }
  | { type: "code"; content: string; filetype?: string }
  | { type: "markdown"; content: string }
  | { type: "structured"; snapshot: ToolSnapshot }

// Which interactive surface the footer is showing. Only one view is active at
// a time. The transport drives transitions: when a permission arrives the view
// switches to "permission", and when the permission resolves it falls back to
// "prompt".
export type FooterView =
  | { type: "prompt" }
  | { type: "permission"; request: MiniPermissionRequest }
  | { type: "form"; request: MiniFormRequest }

export type FooterPromptRoute =
  | { type: "composer" }
  | { type: "queued-menu" }
  | { type: "subagent-menu" }
  | { type: "subagent"; sessionID: Session.ID }
  | { type: "command" }
  | { type: "agent" }
  | { type: "model" }
  | { type: "variant" }
  | { type: "settings" }

export type FooterSubagentTab = {
  sessionID: Session.ID
  label: string
  description: string
  status: "running" | "completed" | "cancelled" | "error"
  background?: boolean
  title?: string
}

export type FooterSubagentDetail = {
  commits: StreamCommit[]
}

export type FooterSubagentState = {
  tabs: FooterSubagentTab[]
  details: Record<string, FooterSubagentDetail>
  permissions: MiniPermissionRequest[]
  forms: MiniFormRequest[]
}

// Typed messages sent to RunFooter.event(). The prompt queue and stream
// transport both emit these to update footer state without reaching into
// internal signals directly.
export type FooterEvent =
  | {
      type: "history"
      history: RunPrompt[]
    }
  | {
      type: "agent"
      agent: Agent.ID | undefined
    }
  | {
      type: "catalog"
      agents: RunAgent[]
      references: RunReference[]
      commands?: RunCommand[]
    }
  | {
      type: "models"
      providers: RunProvider[]
    }
  | {
      type: "variants"
      variants: string[]
      current: string | undefined
    }
  | {
      type: "queued.prompts"
      prompts: FooterQueuedPrompt[]
    }
  | {
      type: "first"
      first: boolean
    }
  | {
      type: "model"
      model: string
      selection: NonNullable<RunInput["model"]>
    }
  | { type: "turn.send" }
  | { type: "turn.idle" }
  | {
      type: "turn.duration"
      duration: string
    }
  | {
      type: "stream.patch"
      patch: FooterPatch
    }
  | {
      type: "stream.view"
      view: FooterView
    }
  | {
      type: "stream.subagent"
      state: FooterSubagentState
    }

export type PermissionReply = Parameters<OpenCodeClient["permission"]["reply"]>[0]

export type FormReply = {
  sessionID: string
  formID: Form.ID
  answer: FormAnswer
  location?: LocationRef
}

export type FormCancel = {
  sessionID: string
  formID: Form.ID
  location?: LocationRef
}

export type RunTuiConfig = Pick<
  Config.Resolved,
  "keybinds" | "leader" | "theme" | "mini" | "prompt" | "session" | "cursor" | "animations"
>

export type MiniSettings = {
  thinking: "show" | "hide"
  tools: "show" | "hide"
  shell_output: "show" | "hide"
  turn_summary: "show" | "hide"
  footer: "show" | "hide"
  splash: "show" | "hide"
  work_spinner: Config.MiniWorkSpinner
  mono: boolean
}

export type MiniVerbosity = "quiet" | "default" | "everything"

export type MiniSettingChange =
  | {
      [Key in keyof MiniSettings]: { key: Key; value: MiniSettings[Key] }
    }[keyof MiniSettings]
  | { key: "verbosity"; value: MiniVerbosity }

// Lifecycle phase of a scrollback entry. "start" opens the entry, "progress"
// appends content (coalesced in the footer queue), "final" closes it.
type StreamPhase = "start" | "progress" | "final"

type StreamSource = "assistant" | "reasoning" | "tool" | "system"

type StreamToolState = "running" | "completed" | "error"

// A single append-only commit to scrollback. The transport produces these from
// V2 events, and RunFooter.append() queues them for the next
// microtask flush. Once flushed, they become immutable terminal scrollback
// rows -- they cannot be rewritten.
export type StreamCommit = {
  kind: EntryKind
  text: string
  image?: string
  phase: StreamPhase
  source: StreamSource
  compaction?: true
  summary?: TurnSummary
  messageID?: SessionMessage.ID
  partID?: string
  tool?: string
  directory?: string
  part?: SessionMessageAssistantTool
  interrupted?: boolean
  toolState?: StreamToolState
  toolError?: string
  shell?: {
    command: string
  }
}

export type LocalReplayRow = {
  commit: StreamCommit
}

// The public contract between the stream transport / prompt queue and
// the footer. RunFooter implements this. The transport and queue never
// touch the renderer directly -- they go through this interface.
export type FooterApi = {
  readonly isClosed: boolean
  onPrompt(fn: (input: RunPrompt) => void): () => void
  onClose(fn: () => void): () => void
  event(next: FooterEvent): void
  append(commit: StreamCommit): void
  idle(): Promise<void>
  close(): void
  destroy(): void
}
