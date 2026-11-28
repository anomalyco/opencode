import type { NativeImage } from "electron"
import { Menu, Tray, nativeImage } from "electron"
import { onTrayMenuRefresh, refreshTrayMenu } from "./tray-menu"
import { nativeT, onNativeTranslations } from "./translations"

export type TrayActions = {
  /** Shows a hidden window or hides the visible one. */
  readonly toggle: () => void
  /** Whether there is no visible window to hide. */
  readonly isHidden: () => boolean
  readonly newTab: () => void
  readonly settings: () => void
  readonly quit: () => void
}

type Config = { readonly icon: string; readonly actions: TrayActions }

let config: Config | undefined

let tray: Tray | undefined

let disposeTray: (() => void) | undefined

/** Whether the tray keeps the app reachable while its windows are hidden. */
export function keepsAppInTray() {
  return !!tray
}

/** Records what the tray would do; the icon is only created once the setting activates it. */
export function configureTray(icon: string, actions: TrayActions) {
  config = { icon, actions }
}

/** A hidden app needs the tray to come back from, so activating without a valid icon is a no-op. */
export function setTrayActive(active: boolean) {
  if (active === !!tray) return

  if (!active) {
    disposeTray?.()
    disposeTray = undefined
    tray = undefined

    return
  }

  if (!config) return
  const image = nativeImage.createFromPath(config.icon)

  if (image.isEmpty()) return

  const created = createTray(image, config.actions)
  tray = created.tray
  disposeTray = created.dispose
}

function createTray(image: NativeImage, actions: TrayActions) {
  const tray = new Tray(image)

  const update = () => {
    tray.setToolTip(nativeT("desktop.tray.tooltip"))

    // Linux only shows a menu installed with setContextMenu; popUpContextMenu is Windows/macOS only.
    tray.setContextMenu(
      Menu.buildFromTemplate([
        {
          label: nativeT(actions.isHidden() ? "desktop.tray.show" : "desktop.tray.hide"),
          click: actions.toggle,
        },
        { label: nativeT("desktop.tray.newTab"), click: actions.newTab },
        { label: nativeT("desktop.tray.settings"), click: actions.settings },
        { type: "separator" },
        { label: nativeT("desktop.tray.quit"), click: actions.quit },
      ]),
    )
  }

  update()
  const stopMenuRefresh = onTrayMenuRefresh(update)

  // Linux owns the left click for its context menu; elsewhere it toggles the hidden window as before.
  if (process.platform !== "linux") {
    tray.on("click", () => {
      actions.toggle()
      refreshTrayMenu()
    })
  }
  tray.on("right-click", refreshTrayMenu)

  const stopTranslations = onNativeTranslations(refreshTrayMenu)

  return {
    tray,
    dispose() {
      stopTranslations()
      stopMenuRefresh()
      tray.destroy()
    },
  }
}
