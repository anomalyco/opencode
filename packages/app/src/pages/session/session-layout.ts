import { useParams } from "@solidjs/router"
import { createMemo } from "solid-js"
import { useLayout } from "@/context/layout"
import { useServer } from "@/context/server"
import { useSDK } from "@/context/sdk"
import { base64Encode } from "@opencode-ai/core/util/encode"
import { SessionRouteKey, SessionStateKey } from "@/utils/server-scope"

export const useSessionKey = () => {
  const params = useParams()
  const server = useServer()
  const sdk = useSDK()
  const scope = createMemo(() => server.scope())
  const dir = createMemo(() => params.dir ?? base64Encode(sdk().directory))
  const workspaceKey = createMemo(() => SessionStateKey.from(scope(), SessionRouteKey.fromRoute(dir())))
  const sessionKey = createMemo(() => SessionStateKey.from(scope(), SessionRouteKey.fromRoute(dir(), params.id)))
  return { params, dir, sessionKey, workspaceKey }
}

export const useSessionLayout = () => {
  const layout = useLayout()
  const { params, dir, sessionKey, workspaceKey } = useSessionKey()
  return {
    params,
    dir,
    sessionKey,
    workspaceKey,
    tabs: createMemo(() => layout.tabs(sessionKey)),
    view: createMemo(() => layout.view(sessionKey)),
  }
}
