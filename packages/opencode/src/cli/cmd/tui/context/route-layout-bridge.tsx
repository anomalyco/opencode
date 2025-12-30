import { createEffect } from "solid-js"
import { createSimpleContext } from "./helper"
import { useRoute } from "./route"
import { useLayout } from "./layout"

export const { use: useRouteLayoutBridge, provider: RouteLayoutBridgeProvider } = createSimpleContext({
  name: "RouteLayoutBridge",
  init: () => {
    const route = useRoute()
    const layout = useLayout()

    createEffect(() => {
      const focused = layout.focusedWindow
      if (!focused) return
      const viewID = route.data.type === "home" ? "home" : `session:${route.data.sessionID}`
      if (focused.viewID !== viewID) {
        layout.setWindowView(focused.id, viewID)
      }
    })

    return {}
  },
})
