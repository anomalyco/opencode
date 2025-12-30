import { createEffect } from "solid-js"
import { createSimpleContext } from "./helper"
import { useRoute } from "./route"
import { useLayout } from "./layout"

export const { use: useRouteLayoutBridge, provider: RouteLayoutBridgeProvider } = createSimpleContext({
  name: "RouteLayoutBridge",
  init: () => {
    const route = useRoute()
    const layout = useLayout()

    // Sync window→route: when focused window changes, update route to match
    // (Disabled: route→window sync was overwriting window views on focus change)
    createEffect(() => {
      const focused = layout.focusedWindow
      if (!focused) return
      // Update route to reflect what the focused window is showing
      if (focused.viewID === "home") {
        if (route.data.type !== "home") {
          route.navigate({ type: "home" })
        }
      } else if (focused.viewID.startsWith("session:")) {
        const sessionID = focused.viewID.slice(8)
        if (route.data.type !== "session" || route.data.sessionID !== sessionID) {
          route.navigate({ type: "session", sessionID })
        }
      }
    })

    return {}
  },
})
