import type { BrowserWindow, Session } from "electron"
import { SidecarCredentials } from "../service/sidecar-credentials"
import { addRendererHeaders, hasHeader, upsertHeader } from "./headers"
import { isRendererUrl } from "./scheme"

const rendererPermissions = new Set(["clipboard-sanitized-write", "notifications"])

// Chromium's Windows pointer lock calls Win32 ClipCursor with the requesting RenderWidgetHostView's
// bounds and does not update the clip when the top-level window moves or maximizes (#57732, #45171).
// Neither the shell nor embedded WebContentsViews use pointer or keyboard lock, so every session
// denies both and defaults to deny-all instead of Electron's grant-all fallback.
const blockedPermissions = new Set(["pointerLock", "keyboardLock"])

export type PermissionSession = Pick<Session, "setPermissionRequestHandler" | "setPermissionCheckHandler">

export type SessionSecurityTarget = {
  on(event: "session-created", listener: (session: Session) => void): void
}

const hardenedSessions = new WeakSet<PermissionSession>()

const allowedBySession = new WeakMap<Session, Set<number>>()

const wiredHeaderSessions = new WeakSet<Session>()

export function hardenSessionPermissions(session: PermissionSession) {
  if (hardenedSessions.has(session)) return
  hardenedSessions.add(session)

  const setRequest = session.setPermissionRequestHandler.bind(session)
  const setCheck = session.setPermissionCheckHandler.bind(session)

  const applyRequest: PermissionSession["setPermissionRequestHandler"] = (handler) => {
    setRequest((webContents, permission, callback, details) => {
      if (blockedPermissions.has(permission) || !handler) {
        callback(false)

        return
      }

      handler(webContents, permission, callback, details)
    })
  }

  const applyCheck: PermissionSession["setPermissionCheckHandler"] = (handler) => {
    setCheck((webContents, permission, requestingOrigin, details) => {
      if (blockedPermissions.has(permission) || !handler) return false

      return handler(webContents, permission, requestingOrigin, details)
    })
  }

  applyRequest(null)
  applyCheck(null)
  session.setPermissionRequestHandler = applyRequest
  session.setPermissionCheckHandler = applyCheck
}

export function wireSessionSecurity(app: SessionSecurityTarget) {
  app.on("session-created", hardenSessionPermissions)
}

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
  hardenSessionPermissions(session)
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
  // embedded pages) can reach the same loopback origin and must not inherit its access. Requests with
  // no frame, such as from a service worker, are not credentialed either; the renderer registers none.
  session.webRequest.onBeforeSendHeaders(
    { urls: ["http://127.0.0.1/*", "http://localhost/*"] },
    (details, callback) => {
      const frame = details.frame
      const renderer = !!frame && frame.parent === null && isRendererUrl(frame.url)
      const authorization = renderer && SidecarCredentials.authorization(SidecarCredentials.get(), details.url)

      if (authorization && !hasHeader(details.requestHeaders, "Authorization")) {
        upsertHeader(details.requestHeaders, "Authorization", authorization)
      }

      callback({ requestHeaders: details.requestHeaders })
    },
  )
  session.webRequest.onHeadersReceived((details, callback) => {
    const responseHeaders = details.responseHeaders ?? {}
    addRendererHeaders(responseHeaders, { document: isRendererUrl(details.url, true) })
    callback({ responseHeaders })
  })
}
