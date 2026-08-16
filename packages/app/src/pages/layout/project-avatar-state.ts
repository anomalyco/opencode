import { createMemo, type Accessor } from "solid-js"
import { useGlobal, useServerCtx } from "@/context/global"
import { sessionPermissionRequest, sessionQuestionForm } from "@/pages/session/composer/session-request-tree"
import { ServerConnection } from "@/context/servers"

export function useSessionTabAvatarState(
  server: Accessor<ServerConnection.Key>,
  directory: Accessor<string>,
  sessionId: Accessor<string>,
) {
  const global = useGlobal()
  const connection = createMemo(() => global.servers.list().find((item) => ServerConnection.key(item) === server()))
  const serverCtx = useServerCtx(connection)
  const hasPermissions = createMemo(() => {
    const ctx = serverCtx()
    if (!ctx) return false
    const permission = ctx.permission
    return !!sessionPermissionRequest(ctx.data.session.list(), ctx.data.session.permission.list, sessionId(), (item) => {
      return !permission.autoResponds(item, directory())
    })
  })
  const hasQuestions = createMemo(() => {
    const data = serverCtx()?.data
    if (!data) return false
    return !!sessionQuestionForm(data.session.list(), data.session.form.list, sessionId())
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
