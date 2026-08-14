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
  const sync = () => serverCtx()?.sync
  const hasPermissions = createMemo(() => {
    const ctx = serverCtx()
    if (!ctx) return false
    const sync = ctx.sync
    const permission = ctx.permission
    const [store] = sync.child(directory(), { bootstrap: false })
    return !!sessionPermissionRequest(store.session, sync.session.data.permission, sessionId(), (item) => {
      return !permission.autoResponds(item, directory())
    })
  })
  const hasQuestions = createMemo(() => {
    const serverSync = sync()
    if (!serverSync) return false
    const [store] = serverSync.child(directory(), { bootstrap: false })
    return !!sessionQuestionForm(store.session, serverSync.session.data.form, sessionId())
  })
  const needsAttention = createMemo(() => hasPermissions() || hasQuestions())
  const unread = createMemo(
    () => needsAttention() || (serverCtx()?.notification.session.unseenCount(sessionId()) ?? 0) > 0,
  )
  const loading = createMemo(() => {
    const serverSync = sync()
    if (!serverSync) return false
    if (needsAttention()) return false
    return serverSync.session.data.session_working(sessionId())
  })
  return { unread, loading }
}
