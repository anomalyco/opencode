import { batch } from "solid-js"
import { createStore, produce } from "solid-js/store"
import { showToast } from "@opencode/ui/toast"
import type { MountedSession, SessionRef, SetupContext } from "../sdk"
import type SideChat from "./index"
import { nextOrdinal, quoteText } from "./transcript"

/** Side chats per session: child sessions forked from the main one, one tab each, until the tab closes. */
export function createSideChat(ctx: SetupContext<typeof SideChat>) {
  const saved = (session: SessionRef) => ctx.stores.chats(session)
  // Unsent composer text by tab id. It lives only as long as the window, like the other composers' unsaved edits.
  const [drafts, setDrafts] = createStore<Record<string, string>>({})
  // Sessions being forked, so a repeated shortcut does not start two chats.
  const starting = new Set<string>()

  const entry = (session: SessionRef, id: string) => saved(session).value?.chats.find((chat) => chat.id === id)

  const fail = (title: string, cause?: unknown) =>
    showToast({ title, description: cause instanceof Error ? cause.message : undefined })

  // The selected conversation text, unless it is in a text field such as a composer.
  const selection = () => {
    const current = window.getSelection()
    const node = current?.anchorNode
    const element = node instanceof Element ? node : node?.parentElement

    if (!current || current.isCollapsed || element?.closest("textarea, input, [contenteditable]")) return ""

    return quoteText(current.toString())
  }

  /** Forks the routed session into a new tab; selected conversation text becomes the start of its composer. */
  const start = async () => {
    const session = ctx.sessions.current()

    if (!session?.id || session.pending || starting.has(session.key)) return

    const data = session.server.data

    if (data.session.message.list(session.id).length === 0) {
      fail(ctx.t("empty.session"))

      return
    }

    const quote = selection()

    starting.add(session.key)

    const forked = await session.server.client.session
      .fork({ sessionID: session.id, child: true })
      .catch((cause: unknown) => {
        fail(ctx.t("start.failed"), cause)

        return undefined
      })
      .finally(() => starting.delete(session.key))

    if (!forked) return

    const discard = () => void session.server.client.session.remove({ sessionID: forked.id }).catch(() => undefined)

    if (ctx.signal.aborted) return discard()

    // The fork's last message is the last one it inherited; the tab leaves everything up to it out of its transcript.
    data.session.remember(forked)
    await data.session.message.sync(forked.id).catch(() => undefined)

    const base = data.session.message.list(forked.id).at(-1)?.id

    if (ctx.signal.aborted) return discard()

    if (!base) {
      fail(ctx.t("start.failed"))

      return discard()
    }

    const id = crypto.randomUUID()

    // The store write may wait for the store to load; the panel keeps the tab hidden until then.
    batch(() => {
      if (quote) setDrafts(id, `${quote}\n\n`)
      saved(session).update((draft) => {
        draft.chats.push({ id, ordinal: nextOrdinal(draft.chats), sessionID: forked.id, base })
      })
      ctx.layout.open(`${ctx.id}:${id}`, session, { tab: "select" })
    })
  }

  return {
    start,
    saved,
    entry,
    draft: (id: string) => drafts[id] ?? "",
    setDraft: (id: string, value: string) => setDrafts(id, value),
    /** Sends a message to the chat's session. */
    send(session: MountedSession, id: string, text: string) {
      const chat = entry(session, id)
      const value = text.trim()

      if (!chat || !value) return

      setDrafts(id, "")
      void session.server.data.session.prompt({ sessionID: chat.sessionID, text: value }).catch((cause: unknown) => {
        setDrafts(id, (current) => current || text)
        fail(ctx.t("send.failed"), cause)
      })
    },
    /** Interrupts the chat's running turn. */
    stop(session: MountedSession, id: string) {
      const chat = entry(session, id)

      if (chat) void session.server.client.session.interrupt({ sessionID: chat.sessionID }).catch(() => undefined)
    },
    /** Attaches selected side chat text to the main chat's next prompt as a quotation. */
    quote(session: MountedSession, id: string, text: string) {
      const chat = entry(session, id)
      const quote = quoteText(text)
      const screen = ctx.screen.current()

      if (!chat || !quote || !screen) return

      screen.composer.attach({
        type: "note",
        origin: ctx.id,
        commentID: crypto.randomUUID(),
        label: ctx.t("quote.label", { number: chat.ordinal }),
        icon: "speech-bubble",
        subject: ctx.t("quote.subject", { number: chat.ordinal }),
        comment: quote,
      })
    },
    /** Closing a tab deletes its session. */
    remove(session: SessionRef, id: string) {
      const chat = entry(session, id)

      setDrafts(
        produce((draft) => {
          delete draft[id]
        }),
      )
      saved(session).update((draft) => {
        draft.chats = draft.chats.filter((item) => item.id !== id)
      })

      if (chat) void session.server.client.session.remove({ sessionID: chat.sessionID }).catch(() => undefined)
    },
  }
}

export type SideChatModel = ReturnType<typeof createSideChat>
