import { createMemo, type Accessor } from "solid-js"
import type { SessionInfo } from "@opencode/client/promise"
import { useGlobal, useServerCtx } from "@/runtime/server/runtime"
import { sessionPermissionRequest, sessionFormRequest } from "@/session/requests/session-request-tree"
import { ServerConnection } from "@/runtime/server/registry"
import { projectSettingsKey, useSettings } from "@/settings/model"

export function useSessionTabAvatarState(
  server: Accessor<ServerConnection.Key>,
  sessionId: Accessor<string>,
  root?: Accessor<boolean>,
  snapshot?: Accessor<SessionInfo | undefined>,
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
    const ctx = serverCtx()

    if (!ctx) return false

    const project = projectSettingsKey(ctx.sdk.scope, ctx.data.session.get(sessionId())?.projectID)

    if (settings.permissions.autoApproves(project)) return false

    return !!sessionPermissionRequest(sessions(), ctx.data.session.permission.list, sessionId())
  })

  const hasForms = createMemo(() => {
    const data = serverCtx()?.data

    if (!data) return false

    return !!sessionFormRequest(sessions(), data.session.form.list, sessionId())
  })

  const needsAttention = createMemo(() => hasPermissions() || hasForms())

  const unread = createMemo(
    () => needsAttention() || (serverCtx()?.notification.session.unread(sessionId(), snapshot?.()) ?? false),
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
