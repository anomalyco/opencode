import { useParams } from "@solidjs/router"
import { createMemo } from "solid-js"
import { useLayout } from "@/shell/state/layout"
import { SessionRouteKey, SessionStateKey } from "@/runtime/server/scope"
import { useWorkspaceLocation } from "@/workspaces/location"
import { useServerSDK } from "@/runtime/server/client"
import { base64Encode } from "@opencode-ai/util/encode"
import { ServerConnection } from "@/runtime/server/registry"
import { findSessionTab, useTabs } from "@/shell/tabs/tabs"

export const useSessionKey = () => {
  const params = useParams()
  const sdk = useWorkspaceLocation()
  const serverSDK = useServerSDK()
  const scope = createMemo(() => serverSDK.scope)
  const directory = createMemo(() => base64Encode(sdk().directory))
  const workspaceKey = createMemo(() => SessionStateKey.from(scope(), SessionRouteKey.fromRoute(directory())))
  const sessionKey = createMemo(() => SessionStateKey.from(scope(), SessionRouteKey.fromRoute(directory(), params.id)))
  return { params, sessionKey, workspaceKey }
}

export const useSessionLayout = () => {
  const layout = useLayout()
  const tabs = useTabs()
  const { params, sessionKey, workspaceKey } = useSessionKey()
  const serverSDK = useServerSDK()
  const tab = createMemo(() => {
    if (!params.id) return
    return findSessionTab(tabs.store, ServerConnection.key(serverSDK.server), params.id)
  })
  const panes = {
    terminalOpened: () => tabs.pane(tab(), "terminal"),
    setTerminalOpened: (opened: boolean) => tabs.setPane(tab(), "terminal", opened),
    reviewOpened: () => tabs.pane(tab(), "review"),
    setReviewOpened: (opened: boolean) => tabs.setPane(tab(), "review", opened),
  }
  return {
    params,
    sessionKey,
    workspaceKey,
    tabs: createMemo(() => layout.tabs(sessionKey)),
    view: createMemo(() => layout.view(sessionKey, panes)),
  }
}
