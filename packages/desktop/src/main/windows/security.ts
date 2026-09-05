import { BrowserWindow } from "electron"
import type { Session } from "electron"
import { isMainWindowWebContents, isRendererPermission } from "./permissions"
import { addRendererHeaders, isRendererUrl, upsertHeader } from "./protocol"

const configuredSessions = new WeakSet<Session>()

export function allowRendererPermissions(win: BrowserWindow) {
  const session = win.webContents.session
  if (configuredSessions.has(session)) return
  configuredSessions.add(session)
  const windowIds = () =>
    BrowserWindow.getAllWindows()
      .filter((win) => !win.isDestroyed())
      .map((win) => win.webContents.id)
  session.setPermissionRequestHandler((webContents, permission, callback, details) => {
    callback(
      isRendererPermission(permission) &&
        isRendererUrl(details.requestingUrl) &&
        isMainWindowWebContents(webContents.id, windowIds()),
    )
  })
  session.setPermissionCheckHandler((webContents, permission, requestingOrigin, details) => {
    if (!isRendererPermission(permission)) return false
    if (webContents && !isMainWindowWebContents(webContents.id, windowIds())) return false
    return isRendererUrl(details.requestingUrl) || isRendererUrl(requestingOrigin)
  })
}

export function wireNavigationPolicy(win: BrowserWindow, openExternalURL: (url: string) => unknown) {
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (!isRendererUrl(url)) openExternalURL(url)
    return { action: "deny" }
  })
  win.webContents.on("will-navigate", (event, url) => {
    if (isRendererUrl(url)) return
    event.preventDefault()
    openExternalURL(url)
  })
}

export function wireRendererHeaders(win: BrowserWindow) {
  win.webContents.session.webRequest.onBeforeSendHeaders((details, callback) => {
    upsertHeader(details.requestHeaders, "Access-Control-Allow-Origin", ["*"])
    callback({ requestHeaders: details.requestHeaders })
  })
  win.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    const responseHeaders = details.responseHeaders ?? {}
    addRendererHeaders(details.url, responseHeaders)
    callback({ responseHeaders })
  })
}
