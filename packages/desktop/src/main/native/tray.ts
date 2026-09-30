import { globalShortcut, Menu, nativeImage, nativeTheme, Tray } from "electron"
import type { NativeImage } from "electron"
import log from "electron-log/main.js"
import { TRAY_ENABLED_KEY } from "../storage/keys"
import { getStore } from "../storage/store"
import { nativeT } from "./translations"
import { trayMenu, type TrayActions } from "./tray-menu"
import { traySessionNotification, type TraySessions } from "./tray-sessions"
import type { TrayIcons } from "./tray-icons"
import { trayTabs } from "./tray-tabs"
import { trayStartupPixels } from "./tray-icon-art"
import { registerTrayShortcut } from "./tray-shortcut"

let tray: Tray | undefined
let actions: TrayActions | undefined
let icons: TrayIcons | undefined
let snapshot: TraySessions = { state: "loading", sessions: [], working: 0, attention: 0, more: false }
let menuOpen = false
let shortcut: ReturnType<typeof registerTrayShortcut> | undefined

export function initializeTray() {
  if (tray || !getTrayEnabled()) return () => {}
  const image = nativeImage.createFromBitmap(trayStartupPixels(nativeTheme.shouldUseDarkColors ? 255 : 32), {
    width: 36,
    height: 36,
    scaleFactor: 2,
  })
  image.setTemplateImage(process.platform === "darwin")
  tray = createTray(image)
  tray.setToolTip(nativeT("desktop.menu.app"))
  const menu = Menu.buildFromTemplate([
    { label: nativeT("desktop.tray.starting"), enabled: false },
    { type: "separator" },
    { label: nativeT("desktop.tray.quit"), role: "quit" },
  ])
  menu.on("menu-will-show", () => {
    menuOpen = true
  })
  menu.on("menu-will-close", () => {
    menuOpen = false
  })
  tray.setContextMenu(menu)
  return destroyTray
}

export function setTraySessions(next?: TraySessions) {
  const current = next ?? { ...snapshot, state: "offline" as const }
  const tabs = new Set(trayTabs.sessions())
  const sessions = current.sessions
    .filter((session) => tabs.has(session.id))
    .map((session) => ({ ...session, avatar: trayTabs.avatar(session.id) }))
  // Closing a tab takes effect immediately, including when an older poll is
  // still in flight. It must not put a closed session back into the menu.
  snapshot = {
    ...current,
    state: tabs.size ? current.state : "ready",
    sessions,
    working: sessions.filter((session) => session.status === "working").length,
    attention: sessions.filter((session) => session.status === "question" || session.status === "permission").length,
  }
  if (icons) tray?.setImage(icons.app(snapshot.sessions.some(traySessionNotification)))
  // Don't move rows underneath the pointer while a native menu is open.
  if (!menuOpen) updateTray()
}

export function syncTrayTabs() {
  setTraySessions(snapshot)
}

export function getTrayEnabled() {
  return getStore().get(TRAY_ENABLED_KEY) !== false
}

export function hasTray() {
  return tray !== undefined
}

export function setTrayEnabled(enabled: boolean) {
  getStore().set(TRAY_ENABLED_KEY, enabled)
  updateTray()
}

export function startTray(next: TrayActions, artwork: TrayIcons) {
  actions = next
  icons = artwork
  updateTray()
  nativeTheme.on("updated", updateTray)
  return () => {
    nativeTheme.off("updated", updateTray)
    destroyTray()
    actions = undefined
    icons = undefined
    menuOpen = false
  }
}

export function updateTray() {
  if (!actions || !icons) return
  if (!getTrayEnabled()) {
    destroyTray()
    return
  }
  if (!tray) tray = createTray(icons.app(snapshot.sessions.some(traySessionNotification)))
  tray.setImage(icons.app(snapshot.sessions.some(traySessionNotification)))
  tray.setToolTip(
    snapshot.state === "ready"
      ? nativeT("desktop.tray.summary", { working: snapshot.working, attention: snapshot.attention })
      : nativeT(`desktop.tray.${snapshot.state}`),
  )
  const version = process.platform === "darwin" ? process.getSystemVersion().split(".").map(Number) : []
  const sublabels = process.platform === "darwin" && (version[0] > 14 || (version[0] === 14 && version[1] >= 4))
  const menu = Menu.buildFromTemplate(trayMenu(actions, snapshot, icons, sublabels))
  menu.on("menu-will-show", () => {
    menuOpen = true
  })
  menu.on("menu-will-close", () => {
    menuOpen = false
    // Replacing a menu during its close event can swallow its selected action.
    setImmediate(() => updateTray())
  })
  tray.setContextMenu(menu)
}

export function trayOnly() {
  return process.argv.includes("--tray") || process.env.OPENCODE_DESKTOP_TRAY_ONLY === "1"
}

function createTray(image: NativeImage) {
  const item = new Tray(image)
  if (process.platform === "win32") item.on("click", () => item.popUpContextMenu())
  shortcut = registerTrayShortcut(globalShortcut, () => {
    if (!menuOpen) item.popUpContextMenu()
  })
  if (!shortcut.registered)
    log.warn("Unable to register tray shortcut; it may be in use by another application", { shortcut: shortcut.key })
  return item
}

function destroyTray() {
  shortcut?.dispose()
  shortcut = undefined
  tray?.destroy()
  tray = undefined
  menuOpen = false
}
