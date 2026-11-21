import { useDialog } from "@opencode/ui/context/dialog"
import { createEffect, createMemo, createSignal, onCleanup } from "solid-js"
import { useLanguage } from "@/runtime/i18n/language"
import { useData, useServer } from "@/runtime/server/current"
import { useGlobal } from "@/runtime/server/runtime"
import { JumpToMessage, type JumpPrompt } from "./jump-to-message"
import type { SessionCommandContext } from "./use-session-commands"

/** The saved messages of one session, opened from the command palette and kept in save order. */
export function DialogFavorites(props: { session: SessionCommandContext["session"]; onJump: (id: string) => void }) {
  const dialog = useDialog()
  const language = useLanguage()
  const data = useData()
  const server = useServer()
  const favorites = useGlobal().messageFavorites
  const key = props.session.identity.sessionKey()
  const id = props.session.identity.params.id

  if (!id) return void dialog.close()

  let controller: AbortController | undefined
  const [opening, setOpening] = createSignal(false)
  const [failed, setFailed] = createSignal(false)

  onCleanup(() => controller?.abort())

  const prompts = createMemo<JumpPrompt[]>(() =>
    favorites.list(server.key, id).map((favorite) => ({
      id: favorite.messageID,
      anchorID: favorite.anchorID,
      text: `${language.t(favorite.role === "user" ? "dialog.favorites.you" : "dialog.favorites.assistant")}: ${favorite.text}`,
      created: favorite.created,
    })),
  )

  const status = () => {
    if (failed()) return language.t("dialog.favorites.unavailable")

    return opening() ? language.t("dialog.jump.opening") : undefined
  }

  // A favorite can point at a message older than the loaded timeline, so page back until it is there.
  // The jump itself targets the prompt row: an assistant message has no DOM anchor of its own.
  const open = async (messageID: string, anchorID?: string) => {
    controller?.abort()
    const current = new AbortController()
    controller = current
    setOpening(true)
    setFailed(false)

    try {
      while (!data.session.message.get(id, messageID)) {
        if (!data.session.message.more(id)) throw new Error("Message unavailable")
        await data.session.message.loadMore(id, { signal: current.signal })
        current.signal.throwIfAborted()
      }

      const messages = data.session.message.list(id)
      const index = messages.findIndex((message) => message.id === messageID)
      const prompt = index < 0 ? undefined : messages.slice(0, index).findLast((message) => message.type === "user")
      const target = anchorID ?? prompt?.id ?? messageID

      dialog.close()
      props.onJump(target)
    } catch {
      if (!current.signal.aborted) setFailed(true)
    } finally {
      if (!current.signal.aborted) setOpening(false)
    }
  }

  createEffect(() => {
    if (key !== props.session.identity.sessionKey()) dialog.close()
  })

  return (
    <JumpToMessage
      prompts={prompts()}
      preserveOrder
      opening={opening()}
      status={status()}
      title={language.t("dialog.favorites.title")}
      description={language.t("dialog.favorites.description")}
      empty={language.t("dialog.favorites.empty")}
      noMatches={language.t("dialog.favorites.noMatches")}
      onClose={() => dialog.close()}
      onJump={(row) => void open(row.id, row.anchorID)}
    />
  )
}
