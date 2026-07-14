// Shared type vocabulary for the direct interactive mode (`opencode mini`).
//
// Direct mode uses a split-footer terminal layout: immutable scrollback for the
// session transcript, and a mutable footer for prompt input, status, and
// permission/question UI. Every module in run/* shares these types to stay
// aligned on that two-lane model.
//
// Data flow through the system:
//
//   V2 events / demo actions → StreamCommit[] + FooterOutput
//     → stream.ts bridges to footer API
//       → footer.ts queues commits and patches the footer view
//         → OpenTUI split-footer renderer writes to terminal
import type {
  OpenCodeClient,
  PermissionV2Request,
  QuestionV2Request,
  ReferenceListOutput,
} from "@opencode-ai/client/promise"
import type { TuiConfig } from "@opencode-ai/tui/config/v1"

export type RunFilePart = {
  type: "file"
  url: string
  filename: string
  mime: string
}

type PromptModel = { providerID: string; modelID: string }

export type RunPromptPart =
  | {
      type: "file"
      url: string
      filename?: string
      mime?: string
      source?: {
        type: string
        text: { start: number; end: number; value: string }
        [key: string]: unknown
      }
    }
  | { type: "agent"; name: string; source?: { start: number; end: number; value: string } }

export type RunCommand = {
  name: string
  description?: string
  source?: string
  template?: string
  hints?: unknown[]
  agent?: string
  model?: {
    [key: string]: unknown
  }
  subtask?: boolean
}

export type RunProviderModel = {
  id: string
  providerID: string
  api?: {
    [key: string]: unknown
  }
  name?: string
  capabilities?: {
    [key: string]: unknown
  }
  cost?: {
    input: number
    output?: number
    cache?: {
      read: number
      write: number
    }
  }
  limit?: {
    context: number
    input?: number
    output?: number
  }
  status?: string
  options?: {
    [key: string]: unknown
  }
  headers?: {
    [key: string]: string
  }
  release_date?: string
  variants?: Record<string, unknown>
}

export type RunProvider = {
  id: string
  name: string
  source?: string
  env?: string[]
  options?: {
    [key: string]: unknown
  }
  models: Record<string, RunProviderModel>
}

export type RunPrompt = {
  messageID?: string
  partID?: string
  text: string
  parts: RunPromptPart[]
  mode?: "shell"
  command?: {
    name: string
    arguments: string
    // Catalog source of the matched slash entry ("skill" routes to session.skill).
    source?: string
  }
}

export type FooterQueuedPrompt = {
  messageID: string
  partID: string
  prompt: RunPrompt
}

export type RunAgent = {
  id: string
  name: string
  description?: string
  mode: "subagent" | "primary" | "all"
  hidden: boolean
}

export type RunReference = ReferenceListOutput["data"][number]

export type RunInput = {
  sdk: OpenCodeClient
  directory: string
  sessionID: string
  sessionTitle?: string
  resume?: boolean
  replay?: boolean
  replayLimit?: number
  agent: string | undefined
  model: PromptModel | undefined
  variant: string | undefined
  files: RunFilePart[]
  initialInput?: string
  thinking: boolean
  demo?: boolean
}

// The semantic role of a scrollback entry. Maps 1:1 to theme colors.
export type EntryKind = "system" | "user" | "assistant" | "reasoning" | "tool" | "error"

// Whether the assistant is actively processing a turn.
export type FooterPhase = "idle" | "running"

// Full snapshot of footer status bar state. Every update replaces the whole
// object in the SolidJS signal so the view re-renders atomically.
export type FooterState = {
  phase: FooterPhase
  status: string
  queue: number
  model: string
  duration: string
  usage: string
  first: boolean
  interrupt: number
  exit: number
}

// A partial update to FooterState. The footer merges this onto the current state.
export type FooterPatch = Partial<FooterState>

export type RunDiffStyle = "auto" | "stacked"

export type TurnSummary = {
  agent: string
  model: string
  duration: string
}

export type ScrollbackOptions = {
  diffStyle?: RunDiffStyle
  suppressBackgrounds?: boolean
}

export type ToolCodeSnapshot = {
  kind: "code"
  title: string
  content: string
  file?: string
}

export type ToolDiffSnapshot = {
  kind: "diff"
  items: Array<{
    title: string
    diff: string
    file?: string
    deletions?: number
  }>
}

export type ToolTaskSnapshot = {
  kind: "task"
  title: string
  rows: string[]
  tail: string
}

export type ToolQuestionSnapshot = {
  kind: "question"
  items: Array<{
    question: string
    answer: string
  }>
  tail: string
}

export type ToolSnapshot = ToolCodeSnapshot | ToolDiffSnapshot | ToolTaskSnapshot | ToolQuestionSnapshot

export type MiniToolState =
  | { status: "pending"; input: Record<string, unknown>; raw?: string }
  | {
      status: "running"
      input: Record<string, unknown>
      title?: string
      metadata?: Record<string, unknown>
      time: { start: number }
    }
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

export type MiniToolPart = {
  id: string
  sessionID: string
  messageID: string
  type?: "tool"
  callID: string
  tool: string
  state: MiniToolState
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
  | { type: "permission"; request: PermissionV2Request }
  | { type: "question"; request: QuestionV2Request }

export type FooterPromptRoute =
  | { type: "composer" }
  | { type: "queued-menu" }
  | { type: "subagent-menu" }
  | { type: "subagent"; sessionID: string }
  | { type: "command" }
  | { type: "skill" }
  | { type: "model" }
  | { type: "variant" }

export type FooterSubagentTab = {
  sessionID: string
  partID: string
  callID: string
  label: string
  description: string
  status: "running" | "completed" | "cancelled" | "error"
  background?: boolean
  title?: string
  toolCalls?: number
  lastUpdatedAt: number
}

export type FooterSubagentDetail = {
  sessionID: string
  commits: StreamCommit[]
}

export type FooterSubagentState = {
  tabs: FooterSubagentTab[]
  details: Record<string, FooterSubagentDetail>
  permissions: PermissionV2Request[]
  questions: QuestionV2Request[]
}

// The transport emits this alongside scrollback commits so the footer can update in the same frame.
export type FooterOutput = {
  patch?: FooterPatch
  view?: FooterView
  subagent?: FooterSubagentState
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
      type: "queue"
      queue: number
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
  | {
      type: "turn.send"
      queue: number
    }
  | {
      type: "turn.wait"
    }
  | {
      type: "turn.idle"
      queue: number
    }
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

export type PermissionReply = Omit<Parameters<OpenCodeClient["permission"]["reply"]>[0], "sessionID">

export type QuestionReply = {
  requestID: string
  answers: string[][]
}

export type QuestionReject = Omit<Parameters<OpenCodeClient["question"]["reject"]>[0], "sessionID">

export type RunTuiConfig = Pick<TuiConfig.Resolved, "keybinds" | "leader_timeout" | "diff_style">

// Lifecycle phase of a scrollback entry. "start" opens the entry, "progress"
// appends content (coalesced in the footer queue), "final" closes it.
export type StreamPhase = "start" | "progress" | "final"

export type StreamSource = "assistant" | "reasoning" | "tool" | "system"

export type StreamToolState = "running" | "completed" | "error"

// A single append-only commit to scrollback. The transport produces these from
// V2 events, and RunFooter.append() queues them for the next
// microtask flush. Once flushed, they become immutable terminal scrollback
// rows -- they cannot be rewritten.
export type StreamCommit = {
  kind: EntryKind
  text: string
  phase: StreamPhase
  source: StreamSource
  summary?: TurnSummary
  messageID?: string
  partID?: string
  tool?: string
  part?: MiniToolPart
  interrupted?: boolean
  toolState?: StreamToolState
  toolError?: string
  shell?: {
    callID: string
    command: string
  }
}

export type LocalReplayAnchor = {
  kind: EntryKind
  text: string
  phase: StreamPhase
  messageID?: string
  partID?: string
  toolState?: StreamToolState
  visible?: string
}

export type LocalReplayRow = {
  commit: StreamCommit
  after?: LocalReplayAnchor
}

// The public contract between the stream transport / prompt queue and
// the footer. RunFooter implements this. The transport and queue never
// touch the renderer directly -- they go through this interface.
export type FooterApi = {
  readonly isClosed: boolean
  onPrompt(fn: (input: RunPrompt) => void): () => void
  onQueuedRemove(fn: (messageID: string) => boolean | Promise<boolean>): () => void
  onClose(fn: () => void): () => void
  event(next: FooterEvent): void
  append(commit: StreamCommit): void
  idle(): Promise<void>
  close(): void
  destroy(): void
}
