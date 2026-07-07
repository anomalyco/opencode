import { createMemo, type Accessor } from "solid-js"
import { useGlobal } from "@/context/global"
import { useNotification } from "@/context/notification"
import { usePermission } from "@/context/permission"
import { ServerConnection } from "@/context/server"
import { sessionPermissionRequest } from "@/pages/session/composer/session-request-tree"

export function useSessionTabAvatarState(
  server: Accessor<ServerConnection.Key>,
  directory: Accessor<string>,
  sessionId: Accessor<string>,
) {
  const global = useGlobal()
  const notification = useNotification()
  const permission = usePermission()
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
      return !permission.autoResponds(item, directory())
    })
  })
  const unread = createMemo(() => {
    if (hasPermissions()) return true
    if (!connection()) return false
    return notification.ensureServerState(server()).session.unseenCount(sessionId()) > 0
  })
  const loading = createMemo(() => {
    const serverSync = sync()
    if (!serverSync) return false
    if (hasPermissions()) return false
    return serverSync.session.data.session_working(sessionId())
  })
  return { unread, loading }
}
