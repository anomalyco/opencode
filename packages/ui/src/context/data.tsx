import type {
  Message,
  Session,
  Part,
  FileDiff,
  SessionStatus,
  PermissionRequest,
  QuestionRequest,
  QuestionAnswer,
} from "@opencode-ai/sdk/v2"
import { createSimpleContext } from "./helper"
import { PreloadMultiFileDiffResult } from "@pierre/diffs/ssr"
import { createSignal } from "solid-js"

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
  question?: {
    [sessionID: string]: QuestionRequest[]
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

export type QuestionReplyFn = (input: { requestID: string; answers: QuestionAnswer[] }) => void

export type QuestionRejectFn = (input: { requestID: string }) => void

export type NavigateToSessionFn = (sessionID: string) => void

export type SessionHrefFn = (sessionID: string) => string

export type SyncSessionFn = (sessionID: string) => void | Promise<void>

export type UndoMessageFn = (sessionID: string, messageID: string) => void | Promise<void>

export type ForkMessageFn = (sessionID: string, messageID: string) => void | Promise<void>

export const { use: useData, provider: DataProvider } = createSimpleContext({
  name: "Data",
  init: (props: {
    data: Data
    directory: string
    onPermissionRespond?: PermissionRespondFn
    onQuestionReply?: QuestionReplyFn
    onQuestionReject?: QuestionRejectFn
    onNavigateToSession?: NavigateToSessionFn
    onSessionHref?: SessionHrefFn
    onSyncSession?: SyncSessionFn
    onUndoMessage?: UndoMessageFn
    onForkMessage?: ForkMessageFn
  }) => {
    const [pendingRestore, setPendingRestore] = createSignal<Part[] | undefined>()

    const undoMessage: UndoMessageFn | undefined = props.onUndoMessage
      ? async (sessionID, messageID) => {
          const parts = props.data.part[messageID] ?? []
          await props.onUndoMessage!(sessionID, messageID)
          if (parts.length > 0) setPendingRestore([...parts])
        }
      : undefined

    return {
      get store() {
        return props.data
      },
      get directory() {
        return props.directory
      },
      respondToPermission: props.onPermissionRespond,
      replyToQuestion: props.onQuestionReply,
      rejectQuestion: props.onQuestionReject,
      navigateToSession: props.onNavigateToSession,
      sessionHref: props.onSessionHref,
      syncSession: props.onSyncSession,
      undoMessage,
      forkMessage: props.onForkMessage,
      pendingRestore,
      consumeRestore() {
        const parts = pendingRestore()
        setPendingRestore(undefined)
        return parts
      },
    }
  },
})
