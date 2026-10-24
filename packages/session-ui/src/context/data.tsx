import type {
  FileDiffInfo,
  PromptFileAttachment,
  JsonValue,
  SessionInfo,
  SessionMessageUser,
  SessionStatus,
  ShellOutputInput,
  ShellOutputOutput,
} from "@opencode/client/promise"
import { createSimpleContext } from "@opencode/ui/context"
import { PreloadMultiFileDiffResult } from "@pierre/diffs/ssr"

export type SessionSummary = Pick<SessionInfo, "id" | "parentID" | "title" | "time">

type ProviderCatalog = {
  all: Map<string, { models: Record<string, { name: string }> }>
  default: {
    [key: string]: string
  }
  connected: Array<string>
}

type Data = {
  agent?: {
    name: string
    color?: string
  }[]
  provider?: ProviderCatalog
  session: SessionSummary[]
  session_status: {
    [sessionID: string]: SessionStatus
  }
  session_diff: {
    [sessionID: string]: FileDiffInfo[]
  }
  session_diff_preload?: {
    [sessionID: string]: PreloadMultiFileDiffResult<unknown, undefined>[]
  }
}

/** Names a finished turn by its Session and the user message that opened it. */
export type TurnDiffInput = { sessionID: string; from: string }

/** The host's cache of the files each finished turn changed. */
export type TurnDiffSource = {
  /** The turn's diffs, or undefined until they load. */
  get: (input: TurnDiffInput) => readonly FileDiffInfo[] | undefined
  /** Starts loading the turn's diffs unless they are cached or already loading. */
  load: (input: TurnDiffInput) => void
}

export type NavigateToSessionFn = (sessionID: string) => void

export type SessionHrefFn = (sessionID: string) => string

export const { use: useData, provider: DataProvider } = createSimpleContext({
  name: "Data",
  init: (props: {
    data: Data
    directory: string
    sessionID?: string
    /** Whether the host lets the user pick agents; hosts that don't show no agent names. Defaults to true. */
    agents?: boolean
    shellRunning?: (id: string) => boolean
    shellOutput?: (input: ShellOutputInput) => Promise<ShellOutputOutput>
    readAttachment?: (file: PromptFileAttachment) => Promise<PromptFileAttachment>
    /** Reports a failed explicit attachment action; passive viewport loads stay silent. */
    onAttachmentError?: () => void
    turnDiff?: TurnDiffSource
    onNavigateToSession?: NavigateToSessionFn
    onSessionHref?: SessionHrefFn
    /** Sends a prompt as the user, e.g. a reply from an agent-rendered surface. Absent where the user cannot reply. */
    onPrompt?: (input: { sessionID: string; text: string; metadata?: { [key: string]: JsonValue } }) => Promise<void>
    /** The metadata of the session's user prompts, including ones not delivered yet. */
    promptMetadata?: (sessionID: string) => readonly SessionMessageUser["metadata"][]
  }) => {
    return {
      get store() {
        return props.data
      },
      get directory() {
        return props.directory
      },
      get sessionID() {
        return props.sessionID
      },
      get agents() {
        return props.agents ?? true
      },
      navigateToSession: props.onNavigateToSession,
      sessionHref: props.onSessionHref,
      shellRunning: props.shellRunning,
      shellOutput: props.shellOutput,
      readAttachment: props.readAttachment,
      onAttachmentError: props.onAttachmentError,
      turnDiff: props.turnDiff,
      prompt: props.onPrompt,
      promptMetadata: props.promptMetadata,
    }
  },
})
