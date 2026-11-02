import { Menu, nativeImage, Tray } from "electron"
import { onNativeTranslations, nativeT } from "./translations"

export type TrayOptions = {
  /** Absolute path to the channel icon. macOS expects a template image. */
  readonly icon: string
  readonly onShow: () => void
  readonly onQuit: () => void
}

/**
 * Puts OpenCode in the notification area (Windows), menu bar (macOS), or status area (Linux).
 * Returns a disposer, or undefined when the platform cannot create a tray icon.
 */
export function installTray(options: TrayOptions) {
  const image = nativeImage.createFromPath(options.icon)

  if (image.isEmpty()) return undefined

  // A macOS menu-bar icon is a template: the system tints it for the light and dark menu bar.
  if (process.platform === "darwin") image.setTemplateImage(true)

  const tray = new Tray(image)

  const menu = () =>
    Menu.buildFromTemplate([
      { label: nativeT("desktop.tray.show"), click: options.onShow },
      { type: "separator" },
      { label: nativeT("desktop.tray.quit"), click: options.onQuit },
    ])

  tray.setToolTip(nativeT("desktop.tray.tooltip"))
  tray.setContextMenu(menu())

  // Windows and Linux expect a left click to open the app; macOS opens the menu instead.
  if (process.platform !== "darwin") tray.on("click", options.onShow)

  // The renderer pushes a new bundle when the app language changes.
  const stopListening = onNativeTranslations(() => {
    tray.setToolTip(nativeT("desktop.tray.tooltip"))
    tray.setContextMenu(menu())
  })

  return () => {
    stopListening()
    tray.destroy()
  }
}
