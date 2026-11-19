import type { BeforeSendResponse, BrowserWindow, OnBeforeSendHeadersListenerDetails, Session } from "electron"
import { SidecarCredentials } from "../service/sidecar-credentials"
import { addRendererHeaders, hasHeader, upsertHeader } from "./headers"
import { isRendererUrl } from "./scheme"

const rendererPermissions = new Set(["clipboard-sanitized-write", "notifications"])

const allowedBySession = new WeakMap<Session, Set<number>>()

const wiredHeaderSessions = new WeakSet<Session>()

// App windows share Electron's default session, where setPermission*Handler replaces the previous
// handler. One pair of handlers per session evaluates against the live renderer WebContents set.
export function allowRendererPermissions(win: BrowserWindow) {
  if (win.isDestroyed() || win.webContents.isDestroyed()) return
  const webContents = win.webContents
  const session = webContents.session
  const allowed = allowedBySession.get(session) ?? registerPermissionHandlers(session)
  const id = webContents.id

  if (allowed.has(id)) return
  allowed.add(id)

  const remove = () => {
    allowed.delete(id)
  }

  webContents.once("destroyed", remove)
  win.once("closed", remove)
}

function registerPermissionHandlers(session: Session) {
  const allowed = new Set<number>()
  allowedBySession.set(session, allowed)

  session.setPermissionRequestHandler((webContents, permission, callback, details) => {
    if (permission === "media") {
      callback(
        allowed.has(webContents.id) &&
          isRendererUrl(details.requestingUrl) &&
          details.isMainFrame &&
          "mediaTypes" in details &&
          !!details.mediaTypes?.length &&
          details.mediaTypes.every((type) => type === "audio"),
      )

      return
    }

    callback(rendererPermissions.has(permission) && isRendererUrl(details.requestingUrl) && allowed.has(webContents.id))
  })

  session.setPermissionCheckHandler((webContents, permission, requestingOrigin, details) => {
    if (permission === "media") {
      return (
        webContents !== null &&
        allowed.has(webContents.id) &&
        isRendererUrl(details.requestingUrl) &&
        details.isMainFrame &&
        details.mediaType === "audio"
      )
    }

    if (!rendererPermissions.has(permission)) return false

    if (webContents ? !allowed.has(webContents.id) : allowed.size === 0) return false

    return isRendererUrl(details.requestingUrl) || isRendererUrl(requestingOrigin)
  })

  return allowed
}

export function wireNavigationPolicy(win: BrowserWindow, openExternalURL: (url: string) => void) {
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
  const session = win.webContents.session

  if (wiredHeaderSessions.has(session)) return
  wiredHeaderSessions.add(session)

  // The renderer sends sidecar requests without credentials, so its GETs are CORS-simple and need no
  // preflight. Electron applies these listeners in Chromium's extraHeaders mode, after the CORS
  // decision, so adding Authorization here does not reintroduce one.
  //
  // Only the renderer's own top-level frame is credentialed. Other content in this session (web views,
  // embedded pages) can reach the same sidecar origin and must not inherit its access. Requests with
  // no frame, such as from a service worker, are not credentialed either; the renderer registers none.
  const credential = (
    details: OnBeforeSendHeadersListenerDetails,
    callback: (response: BeforeSendResponse) => void,
  ) => {
    const frame = details.frame
    const renderer = !!frame && frame.parent === null && isRendererUrl(frame.url)
    const authorization = renderer && SidecarCredentials.authorization(SidecarCredentials.get(), details.url)

    if (authorization && !hasHeader(details.requestHeaders, "Authorization")) {
      upsertHeader(details.requestHeaders, "Authorization", authorization)
    }

    callback({ requestHeaders: details.requestHeaders })
  }

  // A service configured to listen on another address (a LAN or Tailscale IP) is still the sidecar, so the filter
  // follows its host. Electron keeps one listener per event, so each registration replaces the last.
  const follow = () =>
    session.webRequest.onBeforeSendHeaders({ urls: sidecarUrls(SidecarCredentials.get()) }, credential)

  follow()
  SidecarCredentials.onChange(follow)
  session.webRequest.onHeadersReceived((details, callback) => {
    const responseHeaders = details.responseHeaders ?? {}
    addRendererHeaders(responseHeaders, { document: isRendererUrl(details.url, true) })
    callback({ responseHeaders })
  })
}

// Match patterns ignore the port when they name none, so one pattern covers every port on the host.
function sidecarUrls(sidecar: SidecarCredentials.Data | undefined) {
  const loopback = ["http://127.0.0.1/*", "http://localhost/*"]

  if (!sidecar || !URL.canParse(sidecar.url)) return loopback
  const url = new URL(sidecar.url)

  return [...new Set([...loopback, `${url.protocol}//${url.hostname}/*`])]
}
