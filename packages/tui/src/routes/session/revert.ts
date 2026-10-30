import type { Part, Session } from "@opencode-ai/sdk/v2"
import type { useSync } from "../../context/sync"
import type { useSDK } from "../../context/sdk"
import type { useToast } from "../../ui/toast"
import type { PromptInfo } from "../../component/prompt/history"
import { stripPromptPartIDs } from "../../prompt/part"
import { errorMessage } from "../../util/error"
import { produce, unwrap } from "solid-js/store"

type Sync = ReturnType<typeof useSync>
type SDK = ReturnType<typeof useSDK>
type Toast = ReturnType<typeof useToast>

/** The two revert actions, the configured default first. */
export function revertChoices(filesByDefault: boolean) {
  const messages = {
    files: false,
    title: "Revert messages",
    description: "undo messages, keep file changes",
    value: "session.revert.messages",
  }
  const files = {
    files: true,
    title: "Revert messages and files",
    description: "undo messages and their file changes",
    value: "session.revert.files",
  }
  return filesByDefault ? [files, messages] : [messages, files]
}

/** What the user wrote in a message, as a prompt the composer can take back. */
export function messagePrompt(parts: Part[]) {
  return parts.reduce(
    (agg, part) => {
      if (part.type === "text" && !part.synthetic) agg.input += part.text
      if (part.type === "file") agg.parts.push(stripPromptPartIDs(part))
      return agg
    },
    { input: "", parts: [] as PromptInfo["parts"] },
  )
}

/**
 * Reverts a session to `messageID`. The transcript shows the revert at once, without waiting for the server,
 * whose `session.updated` then replaces it with the stored state; a failed request puts the old state back.
 */
export function revertSession(input: {
  sync: Sync
  sdk: SDK
  toast: Toast
  sessionID: string
  messageID: string
  files: boolean
}) {
  const rollback = showRevert(input.sync, input.sessionID, { messageID: input.messageID })
  return settle(
    input.sdk.client.session.revert({ sessionID: input.sessionID, messageID: input.messageID, files: input.files }),
    rollback,
    input.toast,
    "Failed to revert",
  )
}

/** Restores every reverted message, showing it at once like `revertSession`. */
export function unrevertSession(input: { sync: Sync; sdk: SDK; toast: Toast; sessionID: string }) {
  const rollback = showRevert(input.sync, input.sessionID, undefined)
  return settle(input.sdk.client.session.unrevert({ sessionID: input.sessionID }), rollback, input.toast, "Failed to redo")
}

function showRevert(sync: Sync, sessionID: string, revert: Session["revert"]) {
  const find = () => sync.data.session.findIndex((session) => session.id === sessionID)
  const index = find()
  if (index === -1) return () => {}
  // Stores merge an object set over another and keep the raw object, so both sides are copies, set by assignment.
  const current = sync.data.session[index].revert
  const previous = current && structuredClone(unwrap(current))
  const shown = revert?.messageID
  const assign = (at: number, value: Session["revert"]) =>
    sync.set(
      "session",
      at,
      produce((draft) => {
        draft.revert = value && { ...value }
      }),
    )
  assign(index, revert)
  return () => {
    const at = find()
    if (at === -1 || sync.data.session[at].revert?.messageID !== shown) return
    assign(at, previous)
  }
}

async function settle(
  request: Promise<{ error?: unknown }>,
  rollback: () => void,
  toast: Toast,
  fallback: string,
) {
  const failure = await request.then(
    (result) => result.error,
    (error: unknown) => error ?? fallback,
  )
  if (failure === undefined) return true
  rollback()
  toast.show({ variant: "error", message: failureMessage(failure, fallback) })
  return false
}

function failureMessage(failure: unknown, fallback: string) {
  if (failure && typeof failure === "object" && "message" in failure && typeof failure.message === "string")
    return failure.message
  if (failure instanceof Error) return errorMessage(failure)
  return fallback
}
