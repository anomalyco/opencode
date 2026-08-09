import { createMemo, Show } from "solid-js"
import { useParams } from "@solidjs/router"
import { useGlobal } from "@/context/global"
import { ServerConnection } from "@/context/server"
import { ServerSDKProvider } from "@/context/server-sdk"
import { ServerSyncProvider } from "@/context/server-sync"
import { requireServerKey } from "@/utils/session-route"
import { SessionRouteErrorBoundary, TargetSessionRouteContent } from "./session"

export default function TargetSessionRoute() {
  const params = useParams<{ serverKey: string; id: string }>()
  const global = useGlobal()
  const connection = createMemo(() => {
    const key = requireServerKey(params.serverKey)
    return global.servers.list().find((item) => ServerConnection.key(item) === key)
  })

  return (
    <SessionRouteErrorBoundary sessionID={params.id} serverKey={requireServerKey(params.serverKey)} padded>
      <Show when={requireServerKey(params.serverKey)} keyed>
        <ServerSDKProvider server={connection}>
          <ServerSyncProvider server={connection}>
            <TargetSessionRouteContent />
          </ServerSyncProvider>
        </ServerSDKProvider>
      </Show>
    </SessionRouteErrorBoundary>
  )
}
