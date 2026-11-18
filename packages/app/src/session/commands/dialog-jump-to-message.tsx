import type { SessionMessageUser } from "@opencode/client/promise"
import { useDialog } from "@opencode/ui/context/dialog"
import { createEffect, createMemo, createSignal, onCleanup } from "solid-js"
import { readPromptPresentation } from "@/composer/comment-note"
import { useLanguage } from "@/runtime/i18n/language"
import { useServerSDK } from "@/runtime/server/client"
import { useData } from "@/runtime/server/current"
import type { SessionCommandContext } from "./use-session-commands"
import { parseVoiceDelegation } from "../timeline/voice-delegation"
import { JumpToMessage, type JumpPrompt } from "./jump-to-message"
import {
  selectJumpHistory,
  selectJumpOpening,
  selectJumpStatus,
  startJumpToMessage,
  transitionJumpToMessage,
  type JumpToMessageEffect,
  type JumpToMessageEvent,
} from "./jump-to-message-machine"

function prompt(message: SessionMessageUser, attachment: string): JumpPrompt {
  const presentation = readPromptPresentation(message.metadata)

  const text = presentation?.displayText ?? message.text

  const voice = parseVoiceDelegation(text)

  const labels = [
    voice?.framing ?? voice?.instruction ?? text,
    ...(presentation?.attachments ?? []).map((file) => file.name),
    ...(message.files ?? []).filter((file) => !file.mention).map((file) => file.name || attachment),
    ...(message.agents ?? []).filter((agent) => !agent.mention).map((agent) => `@${agent.name}`),
    ...(message.skills ?? []).filter((skill) => !skill.mention).map((skill) => skill.name),
    ...(presentation?.comments ?? []).map((comment) => {
      if (comment.comment) return comment.comment

      if (comment.type === "quote") return comment.text

      if (comment.type === "note") return comment.subject

      return comment.path
    }),
  ]

  return {
    id: message.id,
    text: labels.filter(Boolean).join("\n"),
    created: message.time.created,
  }
}

export function DialogJumpToMessage(props: {
  session: SessionCommandContext["session"]
  onJump: (id: string) => void
}) {
  const dialog = useDialog()
  const language = useLanguage()
  const data = useData()
  const sdk = useServerSDK()
  const key = props.session.identity.sessionKey()
  const id = props.session.identity.params.id

  if (!id) return void dialog.close()
  let controller: AbortController | undefined
  const start = startJumpToMessage()

  const [state, setState] = createSignal(start.state)

  const dispatch = (event: JumpToMessageEvent) => {
    const next = transitionJumpToMessage(state(), event)

    if (next.state !== state()) setState(next.state)
    next.effects.forEach(run)
  }

  const run = (effect: JumpToMessageEffect) => {
    if (effect.type === "cancel") return controller?.abort()

    if (effect.type === "jump") {
      dialog.close()

      return props.onJump(effect.id)
    }

    controller?.abort()
    const current = new AbortController()

    controller = current

    if (effect.type === "history.load")
      return void loadHistory(current.signal).then(
        (history) =>
          dispatch({
            type: "history.loaded",
            attempt: effect.attempt,
            history,
          }),
        () => dispatch({ type: "history.failed", attempt: effect.attempt }),
      )

    void reveal(effect.target, AbortSignal.any([current.signal, AbortSignal.timeout(60_000)])).then(
      () => dispatch({ type: "opened", attempt: effect.attempt }),
      () => dispatch({ type: "open.failed", attempt: effect.attempt }),
    )
  }

  // Read older prompts into the picker only. Prepending pages to the timeline while browsing would move the reader.
  const loadHistory = async (signal: AbortSignal) => {
    const rows: JumpPrompt[] = []

    // Join the timeline's initial sync before interpreting a missing cursor as the end of history.
    await data.session.message.sync(id)
    signal.throwIfAborted()

    if (!data.session.message.more(id)) return rows
    let cursor: string | undefined

    do {
      const page = await sdk.api.message.list(
        { sessionID: id, type: "user", limit: 200, cursor },
        { signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]) },
      )

      signal.throwIfAborted()

      for (const message of page.data) {
        if (message.type === "user") rows.push(prompt(message, language.t("common.attachment")))
      }

      cursor = page.cursor.next ?? undefined
    } while (cursor)

    return rows
  }

  // Page back only as far as the prompt, so the rest of a long session stays unloaded.
  const reveal = async (messageID: string, signal: AbortSignal) => {
    while (!data.session.message.get(id, messageID)) {
      if (!data.session.message.more(id)) throw new Error("Message unavailable")
      await data.session.message.loadMore(id, { signal })
      signal.throwIfAborted()
    }

    if (
      !props.session.history.visibleUserMessages().some((message) => message.id === messageID) ||
      data.session.input.has(id, messageID)
    )
      throw new Error("Message unavailable")
  }

  start.effects.forEach(run)
  onCleanup(() => dispatch({ type: "disposed" }))
  createEffect(() => {
    if (key !== props.session.identity.sessionKey() || dialog.closing) dispatch({ type: "disposed" })

    if (key !== props.session.identity.sessionKey()) dialog.close()
  })

  const prompts = createMemo(() => {
    const all = new Map(selectJumpHistory(state()).map((row) => [row.id, row]))

    const reverted = data.session.get(id)?.revert?.messageID

    for (const message of props.session.history.visibleUserMessages()) {
      all.set(message.id, prompt(message, language.t("common.attachment")))
    }

    const pending = new Set(data.session.input.list(id))

    return [...all.values()].filter(
      (row) => row.text.trim() && !pending.has(row.id) && (!reverted || row.id < reverted),
    )
  })

  const status = () => {
    const note = selectJumpStatus(state())

    return note && language.t(`dialog.jump.${note}`)
  }

  return (
    <JumpToMessage
      prompts={prompts()}
      opening={selectJumpOpening(state())}
      status={status()}
      onRetry={state().status === "failed" ? () => dispatch({ type: "retry" }) : undefined}
      onClose={() => dialog.close()}
      onJump={(row) =>
        dispatch({
          type: "selected",
          id: row.id,
          loaded: !!data.session.message.get(id, row.id),
        })
      }
    />
  )
}
