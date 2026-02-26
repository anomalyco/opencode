import type {
  Message,
  Session,
  Part,
  FileDiff,
  SessionStatus,
  ProviderListResponse,
  PermissionRequest,
  QuestionRequest,
  QuestionAnswer,
} from "@opencode-ai/sdk/v2"
import { createSimpleContext } from "./helper"
import { PreloadMultiFileDiffResult } from "@pierre/diffs/ssr"

type Data = {
  provider?: ProviderListResponse
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
  message: {
    [sessionID: string]: Message[]
  }
  part: {
    [messageID: string]: Part[]
  }
  permission?: {
    [sessionID: string]: PermissionRequest[]
  }
  question?: {
    [sessionID: string]: QuestionRequest[]
  }
}

export type NavigateToSessionFn = (sessionID: string) => void

export type SessionHrefFn = (sessionID: string) => string

export type RespondToPermissionFn = (input: {
  sessionID: string
  permissionID: string
  response: "once" | "always" | "reject"
}) => void

export type ReplyToQuestionFn = (input: { requestID: string; answers: QuestionAnswer[] }) => void

export type RejectQuestionFn = (input: { requestID: string }) => void

export const { use: useData, provider: DataProvider } = createSimpleContext({
  name: "Data",
  init: (props: {
    data: Data
    directory: string
    onNavigateToSession?: NavigateToSessionFn
    onSessionHref?: SessionHrefFn
    onRespondToPermission?: RespondToPermissionFn
    onReplyToQuestion?: ReplyToQuestionFn
    onRejectQuestion?: RejectQuestionFn
  }) => {
    return {
      get store() {
        return props.data
      },
      get directory() {
        return props.directory
      },
      navigateToSession: props.onNavigateToSession,
      sessionHref: props.onSessionHref,
      respondToPermission: props.onRespondToPermission,
      replyToQuestion: props.onReplyToQuestion,
      rejectQuestion: props.onRejectQuestion,
    }
  },
})
