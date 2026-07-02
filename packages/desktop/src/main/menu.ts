import { BrowserWindow, Menu, shell } from "electron"
import type { MenuItemConstructorOptions } from "electron"
import {
  DESKTOP_MENU,
  desktopMenuVisible,
  type DesktopMenuEntry,
  type DesktopMenuPlatform,
  type DesktopMenuRole,
} from "@opencode-ai/app/desktop-menu"

import { UPDATER_ENABLED } from "./constants"
import { runDesktopMenuAction } from "./desktop-menu-actions"

type Deps = {
  trigger: (id: string) => void
  checkForUpdates: () => void
  relaunch: () => void
}

type MenuOptions = {
  /** List of accelerator strings (e.g. "Ctrl+M", "Ctrl+W") to disable on Windows. */
  disabledAccelerators?: string[]
}

const ROLE_ACCELERATORS: Partial<Record<DesktopMenuRole, string>> = {
  close: "Ctrl+W",
  cut: "Ctrl+X",
  copy: "Ctrl+C",
  paste: "Ctrl+V",
  selectAll: "Ctrl+A",
  undo: "Ctrl+Z",
  redo: "Ctrl+Y",
  reload: "Ctrl+R",
  zoomIn: "Ctrl++",
  zoomOut: "Ctrl+-",
  resetZoom: "Ctrl+0",
  togglefullscreen: "F11",
}

export function createMenu(deps: Deps, options?: MenuOptions) {
  if (process.platform === "linux") return

  const platform: DesktopMenuPlatform = process.platform === "darwin" ? "macos" : "windows"
  const disabledAccels = new Set(options?.disabledAccelerators ?? [])

  const template = DESKTOP_MENU.filter((menu) => desktopMenuVisible(menu, platform)).map((menu) => {
    // On macOS, menus with a native role (like windowMenu) use the built-in role directly.
    // On Windows, we build them manually so we can control accelerators.
    if (menu.role && platform === "macos") return { role: nativeRole(menu.role) }

    return {
      label: menu.label,
      submenu: menu.items
        ?.filter((entry) => desktopMenuVisible(entry, platform))
        .map((entry) => nativeItem(entry, deps, platform, disabledAccels)),
    }
  })

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

function nativeItem(
  entry: DesktopMenuEntry,
  deps: Deps,
  platform: DesktopMenuPlatform,
  disabledAccelerators: Set<string>,
): MenuItemConstructorOptions {
  if (entry.type === "separator") return { type: "separator" }

  // If this entry has a role AND the user wants to disable its built-in accelerator,
  // convert it to a manual action item instead of using the native role.
  // Only convert if the entry has a real handler — otherwise the item becomes a no-op.
  if (entry.role) {
    if (platform === "windows") {
      const roleAccel = ROLE_ACCELERATORS[entry.role]
      if (roleAccel && disabledAccelerators.has(roleAccel) && (entry.action || entry.command || entry.href)) {
        return buildManualItem(entry, deps, platform, disabledAccelerators)
      }
    }
    return { role: nativeRole(entry.role) }
  }

  return buildManualItem(entry, deps, platform, disabledAccelerators)
}

function buildManualItem(
  entry: DesktopMenuEntry,
  deps: Deps,
  platform: DesktopMenuPlatform,
  disabledAccelerators: Set<string>,
): MenuItemConstructorOptions {
  const accelerator = platform === "macos" ? entry.accelerator?.macos : entry.accelerator?.windows

  const item: MenuItemConstructorOptions = {
    label: entry.label,
    accelerator: accelerator && !disabledAccelerators.has(accelerator) ? accelerator : undefined,
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
    item.click = () => shell.openExternal(href)
  }

  return item
}

function nativeRole(role: DesktopMenuRole) {
  return role as NonNullable<MenuItemConstructorOptions["role"]>
}
