import { BrowserWindow, Menu } from "electron"
import type { MenuItemConstructorOptions } from "electron"
import {
  DESKTOP_MENU,
  desktopMenuVisible,
  type DesktopMenuEntry,
  type DesktopMenuRole,
} from "@opencode-ai/app/desktop-menu"

import { UPDATER_ENABLED } from "./constants"
import { runDesktopMenuAction } from "./desktop-menu-actions"
import { openExternalURL } from "./windows"
import { nativeT } from "./native-translations"

type Deps = {
  trigger: (id: string) => void
  checkForUpdates: () => void
  relaunch: () => void
}

export function createMenu(deps: Deps) {
  if (process.platform !== "darwin") {
    // Electron installs a default application menu while none is set, and its window
    // menu binds the `close` role to CommandOrControl+W, which closes the whole window
    // before the renderer's `tab.close` (mod+w) keybind can run. The menu bar is hidden
    // on Windows/Linux (see `autoHideMenuBar`), so this exists only for the other
    // accelerators; reinstall an equivalent menu without the window-close accelerator.
    Menu.setApplicationMenu(
      Menu.buildFromTemplate([
        { role: "fileMenu" },
        { role: "editMenu" },
        { role: "viewMenu" },
        { label: nativeT("desktop.menu.window"), submenu: [{ role: "minimize" }] },
      ]),
    )
    return
  }

  const template = DESKTOP_MENU.filter((menu) => desktopMenuVisible(menu, "macos")).map((menu) => {
    if (menu.role) return { role: nativeRole(menu.role), label: nativeT(menu.labelKey) }
    return {
      label: nativeT(menu.labelKey),
      submenu: menu.items
        ?.filter((entry) => desktopMenuVisible(entry, "macos"))
        .map((entry) => nativeItem(entry, deps)),
    }
  })

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

function nativeItem(entry: DesktopMenuEntry, deps: Deps): MenuItemConstructorOptions {
  if (entry.type === "separator") return { type: "separator" }
  if (entry.role) return { role: nativeRole(entry.role), label: entry.labelKey ? nativeT(entry.labelKey) : undefined }

  const item: MenuItemConstructorOptions = {
    label: entry.labelKey ? nativeT(entry.labelKey) : undefined,
    accelerator: entry.accelerator?.macos,
    enabled: entry.enabled === "updater" ? UPDATER_ENABLED : undefined,
  }

  if (entry.command) {
    const command = entry.command
    item.click = () => deps.trigger(command)
  }
  if (entry.action) {
    const action = entry.action
    item.click = () =>
      runDesktopMenuAction(BrowserWindow.getFocusedWindow(), action, {
        checkForUpdates: deps.checkForUpdates,
        relaunch: deps.relaunch,
      })
  }
  if (entry.href) {
    const href = entry.href
    item.click = () => openExternalURL(href)
  }

  return item
}

function nativeRole(role: DesktopMenuRole) {
  return role as NonNullable<MenuItemConstructorOptions["role"]>
}
