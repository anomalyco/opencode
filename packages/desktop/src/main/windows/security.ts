import type { BrowserWindow } from "electron"
import { addRendererHeaders } from "./headers"
import { isRendererUrl } from "./protocol"

const rendererPermissions = new Set(["clipboard-sanitized-write", "notifications"])

export function allowRendererPermissions(win: BrowserWindow) {
  const webContentsId = win.webContents.id
  win.webContents.session.setPermissionRequestHandler((webContents, permission, callback, details) => {
    callback(
      rendererPermissions.has(permission) && isRendererUrl(details.requestingUrl) && webContents.id === webContentsId,
    )
  })
  win.webContents.session.setPermissionCheckHandler((webContents, permission, requestingOrigin, details) => {
    if (!rendererPermissions.has(permission)) return false
    if (webContents && webContents.id !== webContentsId) return false
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
  win.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    const responseHeaders = details.responseHeaders ?? {}
    addRendererHeaders(responseHeaders, { document: isRendererUrl(details.url, true) })
    callback({ responseHeaders })
  })
}
