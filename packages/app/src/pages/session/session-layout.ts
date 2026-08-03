import { useParams } from "@solidjs/router"
import { createMemo } from "solid-js"
import { useLayout } from "@/context/layout"
import { SessionRouteKey, SessionStateKey } from "@/utils/server-scope"
import { useSDK } from "@/context/sdk"
import { useServerSDK } from "@/context/server-sdk"
import { base64Encode } from "@opencode-ai/core/util/encode"

export const useSessionKey = () => {
  const params = useParams()
  const sdk = useSDK()
  const serverSDK = useServerSDK()
  const scope = createMemo(() => serverSDK().scope)
  const directory = createMemo(() => base64Encode(sdk().directory))
  const workspaceKey = createMemo(() => SessionStateKey.from(scope(), SessionRouteKey.fromRoute(directory())))
  const sessionKey = createMemo(() => SessionStateKey.from(scope(), SessionRouteKey.fromRoute(directory(), params.id)))
  return { params, sessionKey, workspaceKey }
}

export const useSessionLayout = () => {
  const layout = useLayout()
  const { params, sessionKey, workspaceKey } = useSessionKey()
  return {
    params,
    sessionKey,
    workspaceKey,
    tabs: createMemo(() => layout.tabs(sessionKey)),
    view: createMemo(() => layout.view(sessionKey)),
  }
}
