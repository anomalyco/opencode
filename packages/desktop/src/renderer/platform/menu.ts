import type { Platform } from "@opencode/app/desktop"
import type { ElectronAPI } from "../api-types"
import { resetZoom, zoomIn, zoomOut } from "../window/zoom"
import {
  createMenuRouterState,
  transitionMenuRouter,
  type MenuCommandHandler,
  type MenuRouterEvent,
} from "./menu-machine"

const router = { state: createMenuRouterState() }

function dispatch(event: MenuRouterEvent) {
  const next = transitionMenuRouter(router.state, event)
  router.state = next.state
  // Each command runs on its own, so one that throws cannot drop the ones queued behind it.
  next.commands.forEach((command) =>
    command.ids.forEach((id) =>
      Promise.try(() => command.handler(id)).catch((error) =>
        console.error("[desktop-menu] command failed", id, error),
      ),
    ),
  )
}

/** Commands that arrive before the app interface binds run once it does. */
export function startDesktopMenu(api: ElectronAPI) {
  api.onMenuCommand((id) => dispatch({ type: "command.received", id }))
}

/** Routes menu commands to `handler` until the returned function unbinds it. */
export function bindDesktopMenu(handler: MenuCommandHandler) {
  dispatch({ type: "bound", handler })

  return () => dispatch({ type: "unbound", handler })
}

export function createDesktopMenuAction(api: ElectronAPI): NonNullable<Platform["runDesktopMenuAction"]> {
  return (action) => {
    switch (action) {
      case "view.resetZoom":
        resetZoom()

        return
      case "view.zoomIn":
        zoomIn()

        return
      case "view.zoomOut":
        zoomOut()

        return
    }

    return api.runDesktopMenuAction(action)
  }
}
