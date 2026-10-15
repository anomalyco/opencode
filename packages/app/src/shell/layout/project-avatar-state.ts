import { createMemo, type Accessor } from "solid-js"
import { useGlobal, useServerCtx } from "@/runtime/server/runtime"
import { sessionPermissionRequest, sessionFormRequest } from "@/session/requests/session-request-tree"
import { ServerConnection } from "@/runtime/server/registry"
import { useSettings } from "@/settings/model"

type ServerData = ReturnType<ReturnType<typeof useGlobal>["ensureServerCtx"]>["data"]

export function useSessionTabAvatarState(
  server: Accessor<ServerConnection.Key>,
  sessionId: Accessor<string>,
  root?: Accessor<boolean>,
) {
  const global = useGlobal()
  const settings = useSettings()
  const connection = createMemo(() => global.servers.list().find((item) => ServerConnection.key(item) === server()))
  const serverCtx = useServerCtx(connection)

  const requests = createMemo(() => {
    const data = serverCtx()?.data

    if (!data) return { permission: false, form: false }

    return sessionRequests(data, sessionId(), !!root?.(), settings.permissions.autoApprove())
  })

  const needsAttention = createMemo(() => requests().permission || requests().form)

  const unread = createMemo(
    () => needsAttention() || (serverCtx()?.notification.session.unseenCount(sessionId()) ?? 0) > 0,
  )

  const loading = createMemo(() => {
    const data = serverCtx()?.data

    if (!data) return false

    if (needsAttention()) return false

    if (root?.())
      return data.session
        .list()
        .some((session) => data.session.root(session.id) === sessionId() && sessionBusy(data, session.id))

    return sessionBusy(data, sessionId())
  })

  return { unread, loading }
}

// Pending permission and form requests anywhere in the session (or its family, for roots).
export function sessionRequests(data: ServerData, sessionId: string, root: boolean, autoApprove: boolean) {
  const sessions = root
    ? [...new Set([sessionId, ...data.session.family(sessionId)])].flatMap((id) => {
        const info = data.session.get(id)

        return info ? [info] : []
      })
    : data.session.list()

  return {
    permission: !autoApprove && !!sessionPermissionRequest(sessions, data.session.permission.list, sessionId),
    form: !!sessionFormRequest(sessions, data.session.form.list, sessionId),
  }
}

// Like the TUI, work waiting in the inbox counts as busy; parked synthetic context does not.
export function sessionBusy(data: ServerData, sessionId: string) {
  return (
    data.session.status(sessionId) === "running" ||
    data.session.pending.list(sessionId).some((item) => item.type !== "synthetic")
  )
}
