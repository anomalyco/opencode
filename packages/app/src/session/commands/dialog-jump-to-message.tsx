import type { SessionMessageUser } from "@opencode/client/promise"
import { useDialog } from "@opencode/ui/context/dialog"
import { createEffect, createMemo, createResource, createSignal, onCleanup } from "solid-js"
import { readPromptPresentation } from "@/composer/comment-note"
import { useLanguage } from "@/runtime/i18n/language"
import { useServerSDK } from "@/runtime/server/client"
import { useData } from "@/runtime/server/current"
import type { SessionCommandContext } from "./use-session-commands"
import { parseVoiceDelegation } from "../timeline/voice-delegation"
import { JumpToMessage, type JumpPrompt } from "./jump-to-message"

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

  return { id: message.id, text: labels.filter(Boolean).join("\n"), created: message.time.created }
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
  const controller = new AbortController()
  onCleanup(() => controller.abort())
  createEffect(() => {
    if (key !== props.session.identity.sessionKey()) dialog.close()

    if (dialog.closing) controller.abort()
  })

  // Read older prompts into the picker only. Prepending pages to the timeline while browsing would move the reader.
  const [history] = createResource(async () => {
    const rows: JumpPrompt[] = []

    // Join the timeline's initial sync before interpreting a missing cursor as the end of history.
    await data.session.message.sync(id)
    controller.signal.throwIfAborted()

    if (!data.session.message.more(id)) return rows
    let cursor: string | undefined

    do {
      const page = await sdk.api.message.list(
        { sessionID: id, type: "user", limit: 200, cursor },
        { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(30_000)]) },
      )

      controller.signal.throwIfAborted()

      for (const message of page.data) {
        if (message.type === "user") rows.push(prompt(message, language.t("common.attachment")))
      }

      cursor = page.cursor.next ?? undefined
    } while (cursor)

    return rows
  })

  const prompts = createMemo(() => {
    const all = new Map((history.state === "ready" ? history() : []).map((row) => [row.id, row]))

    const reverted = data.session.get(id)?.revert?.messageID

    for (const message of props.session.history.visibleUserMessages()) {
      all.set(message.id, prompt(message, language.t("common.attachment")))
    }

    const pending = new Set(data.session.input.list(id))

    return [...all.values()].filter(
      (row) => row.text.trim() && !pending.has(row.id) && (!reverted || row.id < reverted),
    )
  })

  const [selection, setSelection] = createSignal<string>()

  // The store publishes backfill in one batch. Only then ask the virtualizer to land on the selected bubble.
  const [loaded] = createResource(selection, async (messageID) => {
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(60_000)])

    await data.session.message.loadMore(id, { all: true, signal })
    signal.throwIfAborted()

    if (
      !props.session.history.visibleUserMessages().some((message) => message.id === messageID) ||
      data.session.input.has(id, messageID)
    )
      throw new Error("Message unavailable")

    return messageID
  })

  const jump = (messageID: string) => {
    if (dialog.closing || key !== props.session.identity.sessionKey()) return
    dialog.close()
    props.onJump(messageID)
  }

  createEffect(() => {
    const messageID = loaded.state === "ready" && loaded()

    if (messageID) jump(messageID)
  })

  const status = () => {
    if (loaded.loading) return language.t("dialog.jump.opening")

    if (loaded.error || history.error) return language.t("dialog.jump.failed")

    if (history.loading) return language.t("dialog.jump.loading")
  }

  return (
    <JumpToMessage
      prompts={prompts()}
      opening={loaded.loading}
      status={status()}
      onClose={() => dialog.close()}
      onJump={(row) => {
        if (loaded.loading || dialog.closing || key !== props.session.identity.sessionKey()) return

        if (data.session.message.get(id, row.id)) return jump(row.id)
        setSelection(row.id)
      }}
    />
  )
}
