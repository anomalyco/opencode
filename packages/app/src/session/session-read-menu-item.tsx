import { createMemo, Show } from "solid-js"
import type { SessionInfo } from "@opencode/client/promise"
import { Menu } from "@opencode/ui/menu"
import { useLanguage } from "@/runtime/i18n/language"
import { ServerConnection } from "@/runtime/server/registry"
import { useGlobal } from "@/runtime/server/runtime"
import { useSessionTabAvatarState } from "@/shell/layout/project-avatar-state"

export function SessionReadMenuItem(props: { server: ServerConnection.Key; session: SessionInfo | undefined }) {
  const language = useLanguage()

  const global = useGlobal()

  const session = createMemo(() => {
    const snapshot = props.session

    return snapshot ? (global.serverCtx(props.server)?.data.session.get(snapshot.id) ?? snapshot) : undefined
  })

  const status = useSessionTabAvatarState(
    () => props.server,
    () => session()?.id ?? "",
    () => true,
    session,
  )

  const select = () => {
    const ctx = global.serverCtx(props.server)

    const current = session()

    if (!ctx || !current) return

    // Home and inbox indexes may have a session that has not been loaded yet.
    if (!ctx.data.session.get(current.id)) ctx.data.session.remember(current)

    if (status.unread()) return ctx.notification.session.markRead(current.id)
    ctx.notification.session.markUnread(current.id)
  }

  return (
    <Show
      when={
        session() &&
        global.serverCtx(props.server)?.notification.session.ready() &&
        !status.loading() &&
        !status.attention() &&
        (status.unread() || session()?.time.idle !== undefined)
      }
    >
      <Menu.Item onSelect={select}>{language.t(status.unread() ? "session.markRead" : "session.markUnread")}</Menu.Item>
    </Show>
  )
}
