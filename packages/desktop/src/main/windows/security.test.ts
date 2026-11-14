import { expect, test } from "bun:test"
import { EventEmitter } from "node:events"
import type {
  BeforeSendResponse,
  BrowserWindow,
  OnBeforeSendHeadersListenerDetails,
  Session,
  WebContents,
  WebRequestFilter,
} from "electron"
import { SidecarCredentials } from "../service/sidecar-credentials"
import { allowRendererPermissions, wireRendererHeaders } from "./security"

type RequestHandler = NonNullable<Parameters<Session["setPermissionRequestHandler"]>[0]>

type CheckHandler = NonNullable<Parameters<Session["setPermissionCheckHandler"]>[0]>

type Permission = Parameters<RequestHandler>[1]

type RequestDetails = Parameters<RequestHandler>[3]

type CheckDetails = Parameters<CheckHandler>[3]

const url = "oc://renderer/index.html"

const origin = "oc://renderer"

function createSession() {
  let request: RequestHandler | null = null
  let checkHandler: CheckHandler | null = null

  // SAFETY: allowRendererPermissions touches only setPermissionRequestHandler and setPermissionCheckHandler.
  // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- see SAFETY above
  const session = {
    setPermissionRequestHandler(handler: RequestHandler | null) {
      request = handler
    },
    setPermissionCheckHandler(handler: CheckHandler | null) {
      checkHandler = handler
    },
  } as unknown as Session

  const sender = (id: number) => {
    // SAFETY: permission handlers read only `webContents.id`.
    return { id } as WebContents
  }

  const ask = (
    id: number,
    permission: Permission,
    details: RequestDetails = { requestingUrl: url, isMainFrame: true },
  ) =>
    new Promise<boolean>((resolve) => {
      if (!request) throw new Error("Missing permission request handler")
      request(sender(id), permission, resolve, details)
    })

  const check = (
    id: number | null,
    permission: Permission,
    details: CheckDetails = { requestingUrl: url, isMainFrame: true },
  ) => {
    if (!checkHandler) throw new Error("Missing permission check handler")

    return checkHandler(id === null ? null : sender(id), permission, origin, details)
  }

  return { session, ask, check }
}

function createWindow(id: number, session: Session) {
  let destroyed = false
  const winEvents = new EventEmitter()
  const contentsEvents = new EventEmitter()

  // SAFETY: allowRendererPermissions reads only `isDestroyed`, `once`, and `webContents` (`id`, `session`, `isDestroyed`, `once`).
  // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- see SAFETY above
  const win = {
    isDestroyed: () => destroyed,
    once: winEvents.once.bind(winEvents),
    webContents: {
      id,
      session,
      isDestroyed: () => destroyed,
      once: contentsEvents.once.bind(contentsEvents),
    },
  } as unknown as BrowserWindow

  return {
    win,
    close() {
      destroyed = true
      contentsEvents.emit("destroyed")
      winEvents.emit("closed")
    },
  }
}

test("retains permissions across all live windows on a shared session and revokes closed ones", async () => {
  const shared = createSession()
  const first = createWindow(1, shared.session)
  const second = createWindow(2, shared.session)

  allowRendererPermissions(first.win)
  allowRendererPermissions(second.win)

  const audioReq: RequestDetails = { requestingUrl: url, isMainFrame: true, mediaTypes: ["audio"] }
  const audioCheck: CheckDetails = { requestingUrl: url, isMainFrame: true, mediaType: "audio" }

  expect(await shared.ask(1, "notifications")).toBe(true)
  expect(await shared.ask(2, "notifications")).toBe(true)
  expect(await shared.ask(99, "notifications")).toBe(false)

  expect(shared.check(1, "clipboard-sanitized-write")).toBe(true)
  expect(shared.check(2, "clipboard-sanitized-write")).toBe(true)
  expect(shared.check(99, "clipboard-sanitized-write")).toBe(false)

  expect(await shared.ask(1, "media", audioReq)).toBe(true)
  expect(shared.check(1, "media", audioCheck)).toBe(true)

  second.close()
  expect(await shared.ask(2, "notifications")).toBe(false)
  expect(shared.check(2, "clipboard-sanitized-write")).toBe(false)
  expect(await shared.ask(1, "notifications")).toBe(true)
  expect(shared.check(1, "clipboard-sanitized-write")).toBe(true)
  expect(await shared.ask(1, "media", audioReq)).toBe(true)

  first.close()
  expect(await shared.ask(1, "notifications")).toBe(false)
  expect(shared.check(null, "notifications", { isMainFrame: false })).toBe(false)
})

test.each([
  ["on loopback", "http://127.0.0.1:4096", "http://127.0.0.1/*"],
  ["on a Tailscale address", "http://100.87.251.43:45278", "http://100.87.251.43/*"],
  ["on a LAN name", "http://devbox.local:4096", "http://devbox.local/*"],
])("credentials the renderer's requests to a sidecar %s", async (_name, url, pattern) => {
  const registered: Registration = { urls: [] }

  // SAFETY: wireRendererHeaders touches only webRequest.onBeforeSendHeaders and webRequest.onHeadersReceived.
  // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- see SAFETY above
  const session = {
    webRequest: {
      onBeforeSendHeaders(filter: WebRequestFilter, listener: Listener) {
        registered.urls = filter.urls
        registered.listener = listener
      },
      onHeadersReceived() {},
    },
  } as unknown as Session

  // SAFETY: wireRendererHeaders reads only `webContents.session`.
  // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- see SAFETY above
  wireRendererHeaders({ webContents: { session } } as unknown as BrowserWindow)
  // The window opens before the service is ready, so the filter has to follow the endpoint published later.
  SidecarCredentials.set({ url, password: "secret" })
  expect(registered.urls).toContain(pattern)

  const listener = registered.listener

  if (!listener) throw new Error("Missing onBeforeSendHeaders listener")

  // SAFETY: the listener reads only `url`, `frame.parent`, `frame.url` and `requestHeaders`.
  // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- see SAFETY above
  const details = {
    url: `${url}/api/event`,
    frame: { parent: null, url: "oc://renderer/index.html" },
    requestHeaders: {},
  } as unknown as OnBeforeSendHeadersListenerDetails

  const headers = await new Promise<BeforeSendResponse["requestHeaders"]>((resolve) =>
    listener(details, (response) => resolve(response.requestHeaders)),
  )

  expect(headers).toEqual({ Authorization: `Basic ${Buffer.from("opencode:secret").toString("base64")}` })
})

type Listener = (details: OnBeforeSendHeadersListenerDetails, callback: (response: BeforeSendResponse) => void) => void

type Registration = { urls: string[]; listener?: Listener }
