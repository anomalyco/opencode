import { SessionMessage } from "@opencode/schema/session-message"
import { createSignal, type Accessor } from "solid-js"

/** The subagent composer's stored draft: its text, and the admission a failed send can be retried under. */
export type SubagentDraftState = {
  text: string
  /** Only reused while the text it was sent with is unchanged, so an edited message is admitted under a new ID. */
  retry?: { id: string; text: string }
}

/**
 * Return sends, except while an IME candidate is committed or a newline is asked for. A touch keyboard's Return only
 * adds a line, as in the main composer; a hardware keyboard's Mod+Enter still sends there.
 */
export function subagentEnterAction(
  event: Pick<KeyboardEvent, "key" | "shiftKey" | "isComposing" | "keyCode" | "repeat" | "metaKey" | "ctrlKey">,
  touch: boolean,
): "send" | "default" | "swallow" {
  if (event.key !== "Enter") return "default"

  // Safari delivers the Return that confirms an IME candidate after compositionend, so its keyCode marks it.
  if (event.isComposing || event.keyCode === 229) return "default"

  if (event.shiftKey) return "default"

  if (touch && !event.metaKey && !event.ctrlKey) return "default"

  if (event.repeat) return "swallow"

  return "send"
}

/** A message drafted for one subagent Session: it leaves the draft on send and returns when the send fails. */
export function createSubagentDraft(input: {
  send: (text: string, id: string) => Promise<void>
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- a rejected send is opaque; the caller formats it
  onError: (error: unknown) => void
  /** The persisted draft, scoped to the child Session, so leaving the view keeps both its text and its retry. */
  storage: { draft: Accessor<SubagentDraftState>; set: (draft: SubagentDraftState) => void }
}) {
  const [sending, setSending] = createSignal(false)

  const value = () => input.storage.draft().text
  const retry = () => input.storage.draft().retry

  const setValue = (text: string) => input.storage.set({ ...input.storage.draft(), text })

  const setRetry = (retry: SubagentDraftState["retry"]) => {
    const { retry: _previous, ...rest } = input.storage.draft()
    input.storage.set(retry ? { ...rest, retry } : rest)
  }

  const submit = async () => {
    const text = value().trim()

    if (!text || sending()) return

    const previous = retry()
    const id = previous?.text === text ? previous.id : SessionMessage.ID.create()

    setSending(true)
    setValue("")

    const result = await input.send(text, id).then(
      () => ({ ok: true as const }),
      // oxlint-disable-next-line anti-slop/no-unknown-parameters -- a rejected send is opaque; the caller formats it
      (error: unknown) => ({ ok: false as const, error }),
    )

    setSending(false)

    if (result.ok) {
      setRetry(undefined)

      return
    }

    // The rejected message returns in front of anything typed since, as the main composer restores a failed prompt;
    // no typed text is lost, and a whitespace-only draft is kept as typed.
    const typed = value()
    setValue(typed ? `${text}\n${typed}` : text)
    setRetry({ id, text })
    input.onError(result.error)
  }

  return { value, setValue, sending, submit }
}
