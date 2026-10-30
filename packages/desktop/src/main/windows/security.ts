import type {
  BeforeSendResponse,
  HeadersReceivedResponse,
  OnBeforeSendHeadersListenerDetails,
  OnHeadersReceivedListenerDetails,
  Session,
  WebContents,
  WebRequestFilter,
} from "electron"
import { SidecarCredentials } from "../service/sidecar-credentials"
import { addRendererHeaders, hasHeader, upsertHeader } from "./headers"
import { isRendererUrl } from "./scheme"

const rendererPermissions = new Set(["clipboard-sanitized-write", "notifications"])

type PermissionRequestHandler = NonNullable<Parameters<Session["setPermissionRequestHandler"]>[0]>

type PermissionCheckHandler = NonNullable<Parameters<Session["setPermissionCheckHandler"]>[0]>

type PermissionName = Parameters<PermissionRequestHandler>[1]

type PermissionRequestDetails = Parameters<PermissionRequestHandler>[3]

type PermissionCheckDetails = Parameters<PermissionCheckHandler>[3]

type PermissionSession = {
  setPermissionRequestHandler(
    handler:
      | ((
          webContents: Pick<WebContents, "id">,
          permission: PermissionName,
          callback: (permissionGranted: boolean) => void,
          details: PermissionRequestDetails,
        ) => void)
      | null,
  ): void
  setPermissionCheckHandler(
    handler:
      | ((
          webContents: Pick<WebContents, "id"> | null,
          permission: PermissionName,
          requestingOrigin: string,
          details: PermissionCheckDetails,
        ) => boolean)
      | null,
  ): void
}

type PermissionWindow = {
  isDestroyed(): boolean
  once(event: "closed", listener: () => void): void
  readonly webContents: {
    readonly id: number
    readonly session: PermissionSession
    isDestroyed(): boolean
    once(event: "destroyed", listener: () => void): void
  }
}

type RequestFrame = {
  readonly url: string
  readonly parent: { readonly url: string } | null
}

type HeaderRequestDetails = Pick<OnBeforeSendHeadersListenerDetails, "url" | "requestHeaders"> & {
  readonly frame?: RequestFrame | null
}

type HeaderResponseDetails = Pick<OnHeadersReceivedListenerDetails, "url" | "responseHeaders">

type HeaderSession = {
  readonly webRequest: {
    onBeforeSendHeaders(
      filter: WebRequestFilter,
      listener: ((details: HeaderRequestDetails, callback: (response: BeforeSendResponse) => void) => void) | null,
    ): void
    onHeadersReceived(
      listener:
        | ((details: HeaderResponseDetails, callback: (response: HeadersReceivedResponse) => void) => void)
        | null,
    ): void
  }
}

type HeaderWindow = {
  readonly webContents: {
    readonly session: HeaderSession
  }
}

type NavigationWindow = {
  readonly webContents: Pick<WebContents, "setWindowOpenHandler" | "on">
}

const allowedBySession = new WeakMap<PermissionSession, Set<number>>()

const wiredHeaderSessions = new WeakSet<HeaderSession>()

// App windows share Electron's default session, where setPermission*Handler replaces the previous
// handler. One pair of handlers per session evaluates against the live renderer WebContents set.
export function allowRendererPermissions(win: PermissionWindow) {
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

function registerPermissionHandlers(session: PermissionSession) {
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

export function wireNavigationPolicy(win: NavigationWindow, openExternalURL: (url: string) => void) {
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

export function wireRendererHeaders(win: HeaderWindow) {
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
