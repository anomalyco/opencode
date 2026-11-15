import { BrowserWindow, Menu } from "electron"
import type { MenuItemConstructorOptions } from "electron"
import {
  DESKTOP_MENU,
  desktopMenuKey,
  desktopMenuVisible,
  desktopMenuWithPlugins,
  type DesktopMenu,
  type DesktopMenuEntry,
  type DesktopMenuRole,
} from "@opencode/app/desktop-menu"
import { MenuCommandTriggered } from "../../shared/ipc-rpc/events"
import { emitIpcEvent } from "../ipc-events"

import { runDesktopMenuAction } from "./menu-actions"
import {
  createMenuState,
  selectMenuActionWindow,
  transitionMenu,
  type MenuEvent,
  type MenubarProvider,
} from "./menu-machine"
import { nativeT } from "./translations"

type Deps = {
  /** The window a menu command goes to; the renderer decides what it does there. */
  commandWindow: () => BrowserWindow | null
  installCli: () => void
  createWindow: () => void
  openExternal: (url: string) => void
  relaunch: () => void
}

/** A GUI plugin's contribution to the native menu, already translated by the plugin. */
export type MenubarEntry = {
  readonly menu: string
  readonly id: string
  readonly label: string
  /** A built-in item's command, action, or role, or another contribution's id. */
  readonly after?: string
  enabled(): boolean
  run(): void
}

const installation = { state: createMenuState<Deps>() }

function dispatch(event: MenuEvent<Deps>) {
  const next = transitionMenu(installation.state, event)
  installation.state = next.state
  next.commands.forEach((command) => build(command.deps, command.provider))
}

/** Contributions are read on every build; setting a provider rebuilds an installed menu. */
export function setMenubarProvider(provider: MenubarProvider) {
  dispatch({ type: "provider.changed", provider })
}

/** Rebuilds an installed menu after its contributions or translations changed. */
export function refreshMenu() {
  dispatch({ type: "refreshed" })
}

export function createMenu(deps: Deps) {
  dispatch({ type: "installed", deps })
}

/** Later contributions and translations no longer rebuild the menu. */
export function disposeMenu() {
  dispatch({ type: "disposed" })
}

function build(deps: Deps, provider: MenubarProvider) {
  if (process.platform !== "darwin") return

  const extra = provider()

  const template = DESKTOP_MENU.filter((menu) => desktopMenuVisible(menu, "macos")).map((menu) =>
    nativeMenu(
      menu,
      extra.filter((item) => item.menu === menu.id),
      deps,
    ),
  )

  const built = Menu.buildFromTemplate(template)

  // Electron freezes a built item's state; contributions re-read theirs whenever a menu opens.
  const refresh = () =>
    extra.forEach((item) => {
      const target = built.getMenuItemById(item.id)

      if (target) target.enabled = item.enabled()
    })

  if (extra.length) built.items.forEach((item) => item.submenu?.on("menu-will-show", refresh))
  Menu.setApplicationMenu(built)
}

export function sendMenuCommand(win: BrowserWindow, id: string) {
  emitIpcEvent(win.webContents, new MenuCommandTriggered({ id }))
}

function nativeMenu(menu: DesktopMenu, extra: readonly MenubarEntry[], deps: Deps): MenuItemConstructorOptions {
  if (menu.role && !extra.length) return { role: nativeRole(menu.role), label: nativeT(menu.labelKey) }

  const items = desktopMenuWithPlugins(
    (menu.items ?? [])
      .filter((entry) => desktopMenuVisible(entry, "macos"))
      .map((entry) => ({ key: desktopMenuKey(entry), entry })),
    extra,
  )

  const options: MenuItemConstructorOptions = {
    label: nativeT(menu.labelKey),
    submenu: items.map((item) => {
      const entry = item.entry

      if ("menu" in entry)
        return { id: entry.id, label: entry.label, enabled: entry.enabled(), click: () => entry.run() }

      return nativeItem(entry, deps)
    }),
  }

  if (menu.role) options.role = nativeRole(menu.role)

  return options
}

function nativeItem(entry: DesktopMenuEntry, deps: Deps): MenuItemConstructorOptions {
  if (entry.type === "separator") return { type: "separator" }

  if (entry.role)
    return {
      role: nativeRole(entry.role),
      label: entry.labelKey ? nativeT(entry.labelKey) : undefined,
      accelerator: entry.accelerator?.macos,
    }

  const item: MenuItemConstructorOptions = {
    label: entry.labelKey ? nativeT(entry.labelKey) : undefined,
    accelerator: entry.accelerator?.macos,
  }

  if (entry.command) {
    const command = entry.command

    item.click = () => {
      const win = deps.commandWindow()

      if (win) sendMenuCommand(win, command)
    }
  }

  if (entry.action) {
    const action = entry.action
    item.click = () => {
      const win = selectMenuActionWindow(BrowserWindow.getFocusedWindow(), BrowserWindow.getAllWindows())

      runDesktopMenuAction(win, action, {
        installCli: deps.installCli,
        createWindow: deps.createWindow,
        relaunch: deps.relaunch,
      })
    }
  }

  if (entry.href) {
    const href = entry.href
    item.click = () => deps.openExternal(href)
  }

  return item
}

function nativeRole(role: DesktopMenuRole): NonNullable<MenuItemConstructorOptions["role"]> {
  return role
}
