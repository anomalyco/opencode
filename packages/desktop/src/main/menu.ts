import { app, BrowserWindow, Menu, shell } from "electron"
import type { MenuItemConstructorOptions } from "electron"
import {
  DESKTOP_MENU,
  DESKTOP_MENU_LABEL_KEYS,
  desktopMenuLabel,
  desktopMenuVisible,
  type DesktopMenuEntry,
  type DesktopMenuLabelKey,
  type DesktopMenuLabels,
  type DesktopMenuRole,
} from "@opencode-ai/app/desktop-menu"

import { UPDATER_ENABLED } from "./constants"
import { runDesktopMenuAction } from "./desktop-menu-actions"

type Deps = {
  trigger: (id: string) => void
  checkForUpdates: () => void
  relaunch: () => void
}

export function createMenu(deps: Deps) {
  if (process.platform !== "darwin") {
    return {
      show: () => undefined,
      setLabels: (_labels: DesktopMenuLabels) => undefined,
    }
  }

  let labels: DesktopMenuLabels = {}
  let fingerprint = JSON.stringify(labels)
  let shown = false

  const build = () => {
    const template = DESKTOP_MENU.filter((menu) => desktopMenuVisible(menu, "macos")).map((menu) => {
      const label = nativeLabel(menu, labels)
      if (menu.role) return { role: nativeRole(menu.role), label }
      return {
        label,
        submenu: menu.items
          ?.filter((entry) => desktopMenuVisible(entry, "macos"))
          .map((entry) => nativeItem(entry, labels, deps)),
      }
    })

    Menu.setApplicationMenu(Menu.buildFromTemplate(template))
  }

  return {
    show() {
      if (shown) return
      shown = true
      build()
    },
    setLabels(next: DesktopMenuLabels) {
      const normalized = Object.fromEntries(
        DESKTOP_MENU_LABEL_KEYS.flatMap((key) => {
          const value = next?.[key]
          return typeof value === "string" && value.trim() ? [[key, value]] : []
        }),
      )
      const nextFingerprint = JSON.stringify(normalized)
      if (nextFingerprint === fingerprint) return
      labels = normalized
      fingerprint = nextFingerprint
      if (shown) build()
    },
  }
}

function nativeItem(entry: DesktopMenuEntry, labels: DesktopMenuLabels, deps: Deps): MenuItemConstructorOptions {
  if (entry.type === "separator") return { type: "separator" }
  if (entry.role) return { role: nativeRole(entry.role), label: nativeLabel(entry, labels) }

  const item: MenuItemConstructorOptions = {
    label: desktopMenuLabel(entry, labels),
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
    item.click = () => shell.openExternal(href)
  }

  return item
}

function nativeLabel(
  item: { label?: string; labelKey?: DesktopMenuLabelKey; role?: DesktopMenuRole },
  labels: DesktopMenuLabels,
) {
  const label = desktopMenuLabel(item, labels)
  if (!label || !item.role || !["about", "hide", "quit"].includes(item.role)) return label
  return label.replace("OpenCode", app.name)
}

function nativeRole(role: DesktopMenuRole) {
  return role as NonNullable<MenuItemConstructorOptions["role"]>
}
