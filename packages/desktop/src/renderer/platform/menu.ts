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

/**
 * Commands that arrive before the app interface binds run once it does. A key equivalent the page left unhandled runs
 * nothing while the keyboard is in a modal alert dialog, such as a page's prompt: macOS offers the menu every key the
 * focused element does not consume, as Control+` or Option+Down on a prompt's button.
 */
export function startDesktopMenu(api: ElectronAPI) {
  api.onMenuCommand((id, accelerator) => {
    // A minimized or unfocused window keeps its active element: only a window with the keyboard drops the command.
    if (accelerator && document.hasFocus() && document.activeElement?.closest('[role="alertdialog"][aria-modal="true"]')) return
    dispatch({ type: "command.received", id })
  })
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
