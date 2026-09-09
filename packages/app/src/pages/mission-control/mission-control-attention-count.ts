import { createMemo } from "solid-js"
import { useGlobal } from "@/context/global"
import { usePermission } from "@/context/permission"
import { ServerConnection } from "@/context/server"

// The sidebar badge only needs a number, so it counts requests straight off the session store
// instead of building the full record list mission control assembles.
export function useAttentionCount() {
  const global = useGlobal()
  const permission = usePermission()

  return createMemo(() =>
    global.servers.list().reduce((total, conn) => {
      const key = ServerConnection.key(conn)
      const session = global.ensureServerCtx(conn).sync.session
      const state = permission.ensureServerState(key)
      const roots = new Set<string>()
      const rootOf = (sessionID: string) => session.lineage.peek(sessionID)?.root.id ?? sessionID

      for (const [sessionID, requests] of Object.entries(session.data.permission)) {
        if (!requests?.some((request) => !state.autoResponds(request, session.get(sessionID)?.directory))) continue
        roots.add(rootOf(sessionID))
      }
      for (const [sessionID, requests] of Object.entries(session.data.question)) {
        if (!requests?.length) continue
        roots.add(rootOf(sessionID))
      }
      return total + roots.size
    }, 0),
  )
}
