import type { SessionID } from "@opencode/schema/session-id"
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
    [sessionID: SessionID]: SessionStatus
  }
  session_diff: {
    [sessionID: SessionID]: FileDiffInfo[]
  }
  session_diff_preload?: {
    [sessionID: SessionID]: PreloadMultiFileDiffResult<unknown, undefined>[]
  }
}

export type NavigateToSessionFn = (sessionID: SessionID) => void

export type SessionHrefFn = (sessionID: SessionID) => string

export const { use: useData, provider: DataProvider } = createSimpleContext({
  name: "Data",
  init: (props: {
    data: Data
    directory: string
    sessionID?: SessionID
    shellRunning?: (id: string) => boolean
    shellOutput?: (input: ShellOutputInput) => Promise<ShellOutputOutput>
    onNavigateToSession?: NavigateToSessionFn
    onSessionHref?: SessionHrefFn
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
      navigateToSession: props.onNavigateToSession,
      sessionHref: props.onSessionHref,
      shellRunning: props.shellRunning,
      shellOutput: props.shellOutput,
    }
  },
})
