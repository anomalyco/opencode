import { afterEach, describe, expect, test } from "bun:test"
import { SidecarCredentials } from "../service/sidecar-credentials"
import { allowRendererPermissions, wireRendererHeaders } from "./security"

type SecurityWindow = Parameters<typeof allowRendererPermissions>[0] & Parameters<typeof wireRendererHeaders>[0]

type SessionModel = SecurityWindow["webContents"]["session"]

type RequestHandler = NonNullable<Parameters<SessionModel["setPermissionRequestHandler"]>[0]>

type CheckHandler = NonNullable<Parameters<SessionModel["setPermissionCheckHandler"]>[0]>

type BeforeSendListener = NonNullable<Parameters<SessionModel["webRequest"]["onBeforeSendHeaders"]>[1]>

type HeadersReceivedListener = NonNullable<Parameters<SessionModel["webRequest"]["onHeadersReceived"]>[0]>

type Permission = Parameters<RequestHandler>[1]

type RequestDetails = Parameters<RequestHandler>[3]

type CheckDetails = Parameters<CheckHandler>[3]

type SessionState = {
  request: RequestHandler | null
  check: CheckHandler | null
  beforeSend: BeforeSendListener | null
  headersReceived: HeadersReceivedListener | null
  requestRegistrations: number
  checkRegistrations: number
  beforeSendRegistrations: number
  headersReceivedRegistrations: number
}

const rendererUrl = "oc://renderer/index.html"

const rendererOrigin = "oc://renderer"

afterEach(() => {
  SidecarCredentials.set({ url: "http://127.0.0.1:0", password: null })
})

function createSession() {
  const state: SessionState = {
    request: null,
    check: null,
    beforeSend: null,
    headersReceived: null,
    requestRegistrations: 0,
    checkRegistrations: 0,
    beforeSendRegistrations: 0,
    headersReceivedRegistrations: 0,
  }

  const session: SessionModel = {
    setPermissionRequestHandler(handler) {
      state.requestRegistrations += 1
      state.request = handler
    },
    setPermissionCheckHandler(handler) {
      state.checkRegistrations += 1
      state.check = handler
    },
    webRequest: {
      onBeforeSendHeaders(_filter, listener) {
        state.beforeSendRegistrations += 1
        state.beforeSend = listener
      },
      onHeadersReceived(listener) {
        state.headersReceivedRegistrations += 1
        state.headersReceived = listener
      },
    },
  }

  const ask = (
    id: number,
    permission: Permission,
    details: RequestDetails = { requestingUrl: rendererUrl, isMainFrame: true },
  ) =>
    new Promise<boolean>((resolve) => {
      if (!state.request) throw new Error("Missing permission request handler")
      state.request({ id }, permission, resolve, details)
    })

  const check = (
    id: number | null,
    permission: Permission,
    details: CheckDetails = { requestingUrl: rendererUrl, isMainFrame: true },
    origin = rendererOrigin,
  ) => {
    if (!state.check) throw new Error("Missing permission check handler")

    return state.check(id === null ? null : { id }, permission, origin, details)
  }

  return { session, state, ask, check }
}

function createWindow(id: number, session: SessionModel, initiallyDestroyed = false) {
  let windowDestroyed = initiallyDestroyed
  let contentsDestroyed = initiallyDestroyed
  const closedListeners = new Set<() => void>()
  const destroyedListeners = new Set<() => void>()

  const win: SecurityWindow = {
    isDestroyed: () => windowDestroyed,
    once(_event, listener) {
      closedListeners.add(listener)
    },
    webContents: {
      id,
      session,
      isDestroyed: () => contentsDestroyed,
      once(_event, listener) {
        destroyedListeners.add(listener)
      },
    },
  }

  return {
    win,
    close() {
      contentsDestroyed = true
      windowDestroyed = true

      for (const listener of [...destroyedListeners]) {
        destroyedListeners.delete(listener)
        listener()
      }

      for (const listener of [...closedListeners]) {
        closedListeners.delete(listener)
        listener()
      }
    },
    destroyContentsOnly() {
      contentsDestroyed = true

      for (const listener of [...destroyedListeners]) {
        destroyedListeners.delete(listener)
        listener()
      }
    },
  }
}

describe("renderer session security", () => {
  test("preserves permissions across all open windows on a shared session and revokes closed ones", async () => {
    const shared = createSession()
    const first = createWindow(1, shared.session)
    const second = createWindow(2, shared.session)
    const alreadyDestroyed = createWindow(4, shared.session, true)

    allowRendererPermissions(first.win)
    allowRendererPermissions(first.win)
    allowRendererPermissions(second.win)
    allowRendererPermissions(alreadyDestroyed.win)

    const audioReq: RequestDetails = { requestingUrl: rendererUrl, isMainFrame: true, mediaTypes: ["audio"] }
    const audioCheck: CheckDetails = { requestingUrl: rendererUrl, isMainFrame: true, mediaType: "audio" }

    // Both live renderer windows pass; an unregistered embed WebContents (id 99) and pre-destroyed window (id 4) fail.
    expect(await shared.ask(1, "notifications")).toBe(true)
    expect(await shared.ask(2, "notifications")).toBe(true)
    expect(await shared.ask(99, "notifications")).toBe(false)
    expect(await shared.ask(4, "notifications")).toBe(false)

    expect(shared.state.requestRegistrations).toBe(1)
    expect(shared.state.checkRegistrations).toBe(1)

    expect(shared.check(1, "clipboard-sanitized-write")).toBe(true)
    expect(shared.check(2, "clipboard-sanitized-write")).toBe(true)
    expect(shared.check(99, "clipboard-sanitized-write")).toBe(false)
    expect(shared.check(null, "notifications", { isMainFrame: false })).toBe(true)

    expect(await shared.ask(1, "media", audioReq)).toBe(true)
    expect(await shared.ask(2, "media", audioReq)).toBe(true)
    expect(shared.check(1, "media", audioCheck)).toBe(true)
    expect(shared.check(2, "media", audioCheck)).toBe(true)

    // Closing the second window revokes only window 2 while window 1 keeps every renderer permission.
    second.close()
    expect(await shared.ask(2, "notifications")).toBe(false)
    expect(shared.check(2, "clipboard-sanitized-write")).toBe(false)
    expect(shared.check(2, "media", audioCheck)).toBe(false)
    expect(await shared.ask(1, "notifications")).toBe(true)
    expect(shared.check(1, "clipboard-sanitized-write")).toBe(true)
    expect(await shared.ask(1, "media", audioReq)).toBe(true)

    // Destroying the remaining window revokes it and origin-only checks until a new window registers.
    first.destroyContentsOnly()
    expect(await shared.ask(1, "notifications")).toBe(false)
    expect(shared.check(1, "notifications")).toBe(false)
    expect(shared.check(null, "notifications", { isMainFrame: false })).toBe(false)

    const reopened = createWindow(3, shared.session)
    allowRendererPermissions(reopened.win)
    expect(shared.state.requestRegistrations).toBe(1)
    expect(await shared.ask(3, "notifications")).toBe(true)
    expect(shared.check(null, "notifications", { isMainFrame: false })).toBe(true)
  })

  test.each<{
    label: string
    permission: Permission
    requestDetails: RequestDetails
    checkDetails: CheckDetails
    origin?: string
    expected: boolean
  }>([
    {
      label: "notifications from renderer",
      permission: "notifications",
      requestDetails: { requestingUrl: rendererUrl, isMainFrame: true },
      checkDetails: { requestingUrl: rendererUrl, isMainFrame: true },
      expected: true,
    },
    {
      label: "sanitized clipboard writes from renderer",
      permission: "clipboard-sanitized-write",
      requestDetails: { requestingUrl: rendererUrl, isMainFrame: true },
      checkDetails: { requestingUrl: rendererUrl, isMainFrame: true },
      expected: true,
    },
    {
      label: "audio media from main-frame renderer",
      permission: "media",
      requestDetails: { requestingUrl: rendererUrl, isMainFrame: true, mediaTypes: ["audio"] },
      checkDetails: { requestingUrl: rendererUrl, isMainFrame: true, mediaType: "audio" },
      expected: true,
    },
    {
      label: "video media from renderer",
      permission: "media",
      requestDetails: { requestingUrl: rendererUrl, isMainFrame: true, mediaTypes: ["audio", "video"] },
      checkDetails: { requestingUrl: rendererUrl, isMainFrame: true, mediaType: "video" },
      expected: false,
    },
    {
      label: "audio media from subframe",
      permission: "media",
      requestDetails: { requestingUrl: rendererUrl, isMainFrame: false, mediaTypes: ["audio"] },
      checkDetails: { requestingUrl: rendererUrl, isMainFrame: false, mediaType: "audio" },
      expected: false,
    },
    {
      label: "unlisted permission from renderer",
      permission: "geolocation",
      requestDetails: { requestingUrl: rendererUrl, isMainFrame: true },
      checkDetails: { requestingUrl: rendererUrl, isMainFrame: true },
      expected: false,
    },
    {
      label: "allowed permission from external URL",
      permission: "notifications",
      requestDetails: { requestingUrl: "https://example.com", isMainFrame: true },
      checkDetails: { requestingUrl: "https://example.com", isMainFrame: true },
      origin: "https://example.com",
      expected: false,
    },
  ])("evaluates policy for $label -> $expected", async (row) => {
    const shared = createSession()
    const win = createWindow(10, shared.session)
    allowRendererPermissions(win.win)

    expect(await shared.ask(10, row.permission, row.requestDetails)).toBe(row.expected)
    expect(shared.check(10, row.permission, row.checkDetails, row.origin)).toBe(row.expected)
  })

  test("isolates permission sets across distinct sessions and wires webRequest headers once per session", () => {
    const firstSession = createSession()
    const secondSession = createSession()
    const winA1 = createWindow(1, firstSession.session)
    const winA2 = createWindow(2, firstSession.session)
    const winB = createWindow(2, secondSession.session)

    allowRendererPermissions(winA1.win)
    allowRendererPermissions(winB.win)

    expect(firstSession.check(1, "notifications")).toBe(true)
    expect(secondSession.check(1, "notifications")).toBe(false)
    expect(secondSession.check(2, "notifications")).toBe(true)

    wireRendererHeaders(winA1.win)
    wireRendererHeaders(winA2.win)
    wireRendererHeaders(winB.win)

    expect(firstSession.state.beforeSendRegistrations).toBe(1)
    expect(firstSession.state.headersReceivedRegistrations).toBe(1)
    expect(secondSession.state.beforeSendRegistrations).toBe(1)

    SidecarCredentials.set({ url: "http://127.0.0.1:4096", password: "secret" })
    const rendererHeaders: Record<string, string> = {}

    firstSession.state.beforeSend?.(
      {
        url: "http://127.0.0.1:4096/session",
        frame: { url: rendererUrl, parent: null },
        requestHeaders: rendererHeaders,
      },
      () => {},
    )
    expect(rendererHeaders.Authorization).toBe(`Basic ${Buffer.from("opencode:secret").toString("base64")}`)

    const embedHeaders: Record<string, string> = {}

    firstSession.state.beforeSend?.(
      {
        url: "http://127.0.0.1:4096/session",
        frame: { url: "http://127.0.0.1:3000/", parent: null },
        requestHeaders: embedHeaders,
      },
      () => {},
    )
    expect(embedHeaders.Authorization).toBeUndefined()
  })
})
