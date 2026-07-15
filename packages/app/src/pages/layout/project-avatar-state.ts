import { createMemo, type Accessor } from "solid-js"
import { useGlobal } from "@/context/global"
import { useNotification } from "@/context/notification"
import { usePermission } from "@/context/permission"
import { sessionPermissionRequest, sessionQuestionRequest } from "@/pages/session/composer/session-request-tree"
import { ServerConnection } from "@/context/server"

export function useSessionTabAvatarState(
  server: Accessor<ServerConnection.Key>,
  directory: Accessor<string>,
  sessionId: Accessor<string>,
) {
  const global = useGlobal()
  const notification = useNotification()
  const permission = usePermission()
  const permissionState = createMemo(() => permission.ensureServerState(server()))
  const connection = createMemo(() => global.servers.list().find((item) => ServerConnection.key(item) === server()))
  const sync = createMemo(() => {
    const conn = connection()
    if (conn) return global.ensureServerCtx(conn).sync
  })
  const hasPermissions = createMemo(() => {
    const serverSync = sync()
    if (!serverSync) return false
    const [store] = serverSync.child(directory(), { bootstrap: false })
    return !!sessionPermissionRequest(store.session, serverSync.session.data.permission, sessionId(), (item) => {
      return !permissionState().autoResponds(item, directory())
    })
  })
  const hasQuestions = createMemo(() => {
    const serverSync = sync()
    if (!serverSync) return false
    const [store] = serverSync.child(directory(), { bootstrap: false })
    return !!sessionQuestionRequest(store.session, serverSync.session.data.question, sessionId())
  })
  const needsAttention = createMemo(() => hasPermissions() || hasQuestions())
  const unread = createMemo(
    () => needsAttention() || notification.ensureServerState(server()).session.unseenCount(sessionId()) > 0,
  )
  const loading = createMemo(() => {
    const serverSync = sync()
    if (!serverSync) return false
    if (needsAttention()) return false
    return serverSync.session.data.session_working(sessionId())
  })
  return { unread, loading }
}
