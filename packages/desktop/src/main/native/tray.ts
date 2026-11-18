import { Menu, nativeImage, Tray } from "electron"
import type { MenuItemConstructorOptions } from "electron"
import { TRAY_ENABLED_KEY } from "../storage/keys"
import { getStore } from "../storage/store"
import { createTrayState, transitionTray, type TrayDeps } from "./tray-machine"
import { nativeT } from "./translations"

const installation = { state: createTrayState() }

let tray: Tray | undefined

let menu: Electron.Menu | undefined

function dispatch(event: Parameters<typeof transitionTray>[1]) {
  const next = transitionTray(installation.state, event)
  installation.state = next.state
  next.commands.forEach(perform)
}

function perform(command: ReturnType<typeof transitionTray>["commands"][number]) {
  if (command.type === "destroy") {
    tray?.destroy()
    tray = undefined

    return
  }

  // Electron has no way to retitle a Tray, so a rebuild recreates it.
  if (tray) {
    tray.destroy()
    tray = undefined
  }

  createTrayIcon(command.deps)
}

function createTrayIcon(deps: TrayDeps) {
  const image = nativeImage.createFromPath(deps.iconPath)

  // A dev checkout without the channel's copied icons shows no icon rather than a broken one.
  if (image.isEmpty()) return

  tray = new Tray(image)
  tray.setToolTip("OpenCode")

  if (process.platform === "darwin") {
    menu = Menu.buildFromTemplate(trayMenu(deps))
    tray.on("click", () => deps.show())
    tray.on("right-click", () => tray?.popUpContextMenu(menu))

    return
  }

  tray.setContextMenu(Menu.buildFromTemplate(trayMenu(deps)))
}

function trayMenu(deps: TrayDeps): MenuItemConstructorOptions[] {
  return [
    { label: nativeT("desktop.tray.open"), click: () => deps.show() },
    { type: "separator" },
    { label: nativeT("desktop.tray.quit"), click: () => deps.quit() },
  ]
}

export function getTrayEnabled() {
  return getStore().get(TRAY_ENABLED_KEY) === true
}

export function setTrayEnabled(enabled: boolean) {
  if (getTrayEnabled() === enabled) return

  getStore().set(TRAY_ENABLED_KEY, enabled)
  dispatch({ type: "enabled.changed", enabled })
}

export function installTray(deps: TrayDeps) {
  dispatch({ type: "installed", deps, enabled: getTrayEnabled() })
}

/** Rebuilds an installed tray after its translations changed. */
export function refreshTray() {
  dispatch({ type: "refreshed" })
}

export function disposeTray() {
  dispatch({ type: "disposed" })
}

/** Whether a closed window hides to the tray instead of quitting the app. */
export function keepsRunningWithoutWindows() {
  return getTrayEnabled()
}
