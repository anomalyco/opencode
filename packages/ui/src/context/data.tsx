import type { Message, Session, Part, FileDiff, SessionStatus, PermissionRequest } from "@opencode-ai/sdk/v2"
import { createSimpleContext } from "./helper"
import { PreloadMultiFileDiffResult } from "@pierre/diffs/ssr"

type Data = {
  session: Session[]
  session_status: {
    [sessionID: string]: SessionStatus
  }
  session_diff: {
    [sessionID: string]: FileDiff[]
  }
  session_diff_preload?: {
    [sessionID: string]: PreloadMultiFileDiffResult<any>[]
  }
  permission?: {
    [sessionID: string]: PermissionRequest[]
  }
  message: {
    [sessionID: string]: Message[]
  }
  part: {
    [messageID: string]: Part[]
  }
}

export type PermissionRespondFn = (input: {
  sessionID: string
  permissionID: string
  response: "once" | "always" | "reject"
}) => void

export type NavigateToSessionFn = (sessionID: string) => void

export const { use: useData, provider: DataProvider } = createSimpleContext({
  name: "Data",
  init: (props: {
    data: Data
    directory: string
    onPermissionRespond?: PermissionRespondFn
    onNavigateToSession?: NavigateToSessionFn
  }) => {
    return {
      get store() {
        return props.data
      },
      get directory() {
        return props.directory
      },
      respondToPermission: props.onPermissionRespond,
      navigateToSession: props.onNavigateToSession,
    }
  },
})
