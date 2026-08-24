import { BrowserWindow, Menu } from "electron"
import type { MenuItemConstructorOptions } from "electron"
import {
  DESKTOP_MENU,
  desktopMenuVisible,
  type DesktopMenuEntry,
  type DesktopMenuRole,
} from "@opencode-ai/app/desktop-menu"
import { MenuCommandTriggered } from "../../shared/ipc-rpc/events"
import { emitIpcEvent } from "../ipc-events"

import { UPDATER_ENABLED } from "../constants"
import { runDesktopMenuAction } from "./menu-actions"
import { nativeT } from "./translations"

type Deps = {
  trigger: (id: string) => void
  checkForUpdates: () => void
  installCli: () => void
  createWindow: () => void
  openExternal: (url: string) => void
  relaunch: () => void
}

export function createMenu(deps: Deps) {
  if (process.platform !== "darwin") return

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

export function sendMenuCommand(win: BrowserWindow, id: string) {
  emitIpcEvent(win.webContents, new MenuCommandTriggered({ id }))
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
        installCli: deps.installCli,
        createWindow: deps.createWindow,
        relaunch: deps.relaunch,
      })
  }
  if (entry.href) {
    const href = entry.href
    item.click = () => deps.openExternal(href)
  }

  return item
}

function nativeRole(role: DesktopMenuRole) {
  return role as NonNullable<MenuItemConstructorOptions["role"]>
}
