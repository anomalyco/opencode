import { createMemo, type Accessor } from "solid-js"
import { useGlobal, useServerCtx } from "@/runtime/server/runtime"
import { sessionPermissionRequest, sessionFormRequest } from "@/session/requests/session-request-tree"
import { ServerConnection } from "@/runtime/server/registry"
import { useSettings } from "@/settings/model"

export function useSessionTabAvatarState(
  server: Accessor<ServerConnection.Key>,
  sessionId: Accessor<string>,
  root?: Accessor<boolean>,
) {
  const global = useGlobal()
  const settings = useSettings()
  const connection = createMemo(() => global.servers.list().find((item) => ServerConnection.key(item) === server()))
  const serverCtx = useServerCtx(connection)

  const sessions = createMemo(() => {
    const data = serverCtx()?.data

    if (!data) return []

    if (!root?.()) return data.session.list()
    const id = sessionId()

    return [...new Set([id, ...data.session.family(id)])].flatMap((id) => {
      const info = data.session.get(id)

      return info ? [info] : []
    })
  })

  const hasPermissions = createMemo(() => {
    if (settings.permissions.autoApprove()) return false
    const ctx = serverCtx()

    if (!ctx) return false

    return !!sessionPermissionRequest(sessions(), ctx.data.session.permission.list, sessionId())
  })

  const hasForms = createMemo(() => {
    const data = serverCtx()?.data

    if (!data) return false

    return !!sessionFormRequest(sessions(), data.session.form.list, sessionId())
  })

  const needsAttention = createMemo(() => hasPermissions() || hasForms())

  const unread = createMemo(
    () => needsAttention() || (serverCtx()?.notification.session.unseenCount(sessionId()) ?? 0) > 0,
  )

  const loading = createMemo(() => {
    const data = serverCtx()?.data

    if (!data) return false

    if (needsAttention()) return false

    // Like the TUI, work waiting in the inbox counts as busy; parked synthetic context does not.
    const busy = (id: string) =>
      data.session.status(id) === "running" || data.session.pending.list(id).some((item) => item.type !== "synthetic")

    if (root?.())
      return data.session.list().some((session) => data.session.root(session.id) === sessionId() && busy(session.id))

    return busy(sessionId())
  })

  return { unread, loading }
}
