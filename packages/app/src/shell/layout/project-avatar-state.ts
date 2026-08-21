import { createMemo, type Accessor } from "solid-js"
import { useGlobal, useServerCtx } from "@/runtime/server/runtime"
import { sessionPermissionRequest, sessionQuestionForm } from "@/session/requests/session-request-tree"
import { ServerConnection } from "@/runtime/server/registry"

export function useSessionTabAvatarState(
  server: Accessor<ServerConnection.Key>,
  directory: Accessor<string>,
  sessionId: Accessor<string>,
  root?: Accessor<boolean>,
) {
  const global = useGlobal()
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
    const permission = ctx.permission
    return !!sessionPermissionRequest(sessions(), ctx.data.session.permission.list, sessionId(), (item) => {
      return !permission.autoResponds(item, directory())
    })
  })
  const hasQuestions = createMemo(() => {
    const data = serverCtx()?.data
    if (!data) return false
    return !!sessionQuestionForm(sessions(), data.session.form.list, sessionId())
  })
  const needsAttention = createMemo(() => hasPermissions() || hasQuestions())
  const unread = createMemo(
    () => needsAttention() || (serverCtx()?.notification.session.unseenCount(sessionId()) ?? 0) > 0,
  )
  const loading = createMemo(() => {
    const data = serverCtx()?.data
    if (!data) return false
    if (needsAttention()) return false
    return data.session.status(sessionId()) === "running"
  })
  return { unread, loading }
}
