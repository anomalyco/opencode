import { useParams, useSearchParams } from "@solidjs/router"
import { createMemo } from "solid-js"
import { useLayout } from "@/shell/state/layout"
import { SessionRouteKey, SessionStateKey } from "@/runtime/server/scope"
import { useWorkspaceLocation } from "@/workspaces/location"
import { useServerSDK } from "@/runtime/server/client"
import { base64Encode } from "@opencode/util/encode"
import { ServerConnection } from "@/runtime/server/registry"
import { tabKey, useTabs } from "@/shell/tabs/tabs"

const useSessionKey = () => {
  const params = useParams()
  const [search] = useSearchParams<{ draftId?: string }>()
  const tabs = useTabs()
  const sdk = useWorkspaceLocation()
  const serverSDK = useServerSDK()
  const scope = createMemo(() => serverSDK.scope)
  const directory = createMemo(() => base64Encode(sdk().directory))
  const draft = createMemo(() => tabs.store.find((tab) => tab.type === "draft" && tab.draftID === search.draftId))
  const sessionID = createMemo(() => params.id ?? draft()?.sessionId)
  const workspaceKey = createMemo(() => SessionStateKey.from(scope(), SessionRouteKey.fromRoute(directory())))

  const sessionKey = createMemo(() =>
    SessionStateKey.from(scope(), SessionRouteKey.fromRoute(directory(), sessionID())),
  )

  return { params, draft, sessionID, sessionKey, workspaceKey }
}

export const useSessionLayout = () => {
  const layout = useLayout()
  const tabs = useTabs()
  const { params, draft, sessionID, sessionKey, workspaceKey } = useSessionKey()
  const serverSDK = useServerSDK()

  const currentTab = createMemo(() => {
    const current = draft()

    if (current) return current

    if (!params.id) return

    return tabs.sessionTab(ServerConnection.key(serverSDK.server), params.id)
  })

  const regions = {
    sideOpened: () => tabs.region(currentTab(), "side"),
    setSideOpened: (opened: boolean) => tabs.setRegion(currentTab(), "side", opened),
    // The bottom pane shows whenever it holds tabs until the user hides it.
    bottomOpened: () => tabs.region(currentTab(), "bottom", true),
    setBottomOpened: (opened: boolean) => tabs.setRegion(currentTab(), "bottom", opened),
    sessionWidth: () => tabs.regionSize(currentTab(), "sessionWidth"),
    setSessionWidth: (width: number) => tabs.setRegionSize(currentTab(), "sessionWidth", width),
    bottomHeight: () => tabs.regionSize(currentTab(), "bottomHeight"),
    setBottomHeight: (height: number) => tabs.setRegionSize(currentTab(), "bottomHeight", height),
    splitRatio: () => tabs.regionSize(currentTab(), "splitRatio"),
    setSplitRatio: (ratio: number) => tabs.setRegionSize(currentTab(), "splitRatio", ratio),
  }

  return {
    params,
    sessionID,
    sessionKey,
    workspaceKey,
    tabKey: createMemo(() => {
      const tab = currentTab()

      return tab && tabKey(tab)
    }),
    tabs: createMemo(() => layout.tabs(sessionKey)),
    view: createMemo(() => layout.view(sessionKey, regions)),
  }
}
