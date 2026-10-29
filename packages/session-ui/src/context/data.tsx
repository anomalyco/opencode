import type {
  FileDiffInfo,
  SessionInfo,
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

export type ReadMediaUrlFn = (uri: string, mime: string, signal?: AbortSignal) => Promise<string | undefined>

export type PeekMediaUrlFn = (uri: string, mime: string) => string | undefined

export const { use: useData, provider: DataProvider } = createSimpleContext({
  name: "Data",
  init: (props: {
    data: Data
    directory: string
    sessionID?: string
    /** Whether message meta names the agent; the app follows its Show agent setting. Defaults to true. */
    agents?: boolean
    shellRunning?: (id: string) => boolean
    shellOutput?: (input: ShellOutputInput) => Promise<ShellOutputOutput>
    turnDiff?: TurnDiffSource
    readMedia?: ReadMediaUrlFn
    peekMedia?: PeekMediaUrlFn
    onNavigateToSession?: NavigateToSessionFn
    onSessionHref?: SessionHrefFn
    /** Whether `experimental.background_compaction` is on for this location; automatic compactions then show quietly. */
    backgroundCompaction?: boolean
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
      get backgroundCompaction() {
        return props.backgroundCompaction === true
      },
      navigateToSession: props.onNavigateToSession,
      sessionHref: props.onSessionHref,
      shellRunning: props.shellRunning,
      shellOutput: props.shellOutput,
      turnDiff: props.turnDiff,
      readMedia: props.readMedia,
      peekMedia: props.peekMedia,
    }
  },
})
