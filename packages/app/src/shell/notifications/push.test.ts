import { describe, expect, test } from "bun:test"
import { createApiForServer } from "@/runtime/server/api"
import { createPushController, pushSupport, type PushBrowser } from "./push"

const key = new Uint8Array([1, 2, 3]).buffer

function fixture(options: { scope?: string; id?: string; browser?: PushBrowser } = {}) {
  const calls: string[] = []
  const requests: { path: string; method: string; body: unknown; authorization: string | null }[] = []
  const state = {
    wanted: false,
    permission: "default" as NotificationPermission,
    granted: "granted" as NotificationPermission,
    status: 204,
    getStatus: 200,
    deleteStatus: 204,
    applicationServerKey: key,
    notifications: { agent: true, errors: false },
    titles: { agent: "Response ready", errors: "Session failed" },
    unsubscribe: true,
    subscription: false,
    registered: false,
  }
  const subscription = {
    endpoint: `https://push.example/${options.id ?? "browser"}`,
    options: {
      userVisibleOnly: true,
      get applicationServerKey() {
        return state.applicationServerKey
      },
    },
    toJSON: () => ({ keys: { p256dh: "p256dh", auth: "auth" } }),
    unsubscribe: async () => {
      calls.push("browser-unsubscribe")
      if (state.unsubscribe) state.subscription = false
      return state.unsubscribe
    },
  }
  const registration = {
    pushManager: {
      getSubscription: async () => (state.subscription ? subscription : null),
      subscribe: async (input: PushSubscriptionOptionsInit) => {
        calls.push("browser-subscribe")
        expect(input.userVisibleOnly).toBe(true)
        expect(input.applicationServerKey).toEqual(new Uint8Array(key))
        state.subscription = true
        state.applicationServerKey = key
        return subscription
      },
    },
  }
  const browser: PushBrowser = options.browser ?? {
    issue: () => undefined,
    permission: () => state.permission,
    requestPermission: () => {
      calls.push("permission")
      state.permission = state.granted
      return Promise.resolve(state.permission)
    },
    registration: async (scope) => {
      calls.push(`lookup:${scope}`)
      return state.registered ? registration : undefined
    },
    register: async (scope) => {
      calls.push(`register:${scope}`)
      state.registered = true
      return registration
    },
  }
  const api = createApiForServer({
    server: { url: "https://server.example", password: "test-password" },
    fetch: Object.assign(
      async (url: URL | RequestInfo, init?: RequestInit) => {
        calls.push(init?.method ?? "GET")
        const path = new URL(String(url)).pathname
        requests.push({
          path,
          method: init?.method ?? "GET",
          body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
          authorization: new Headers(init?.headers).get("Authorization"),
        })
        if (init?.method === "GET") return Response.json({ publicKey: "AQID" }, { status: state.getStatus })
        return new Response(null, { status: init?.method === "DELETE" ? state.deleteStatus : state.status })
      },
      { preconnect() {} },
    ),
  })
  const make = () =>
    createPushController({
      api: () => api.push,
      browser,
      scope: options.scope ?? "/push/server-a/",
      id: () => options.id ?? "browser-id",
      url: "https://app.example/server/server-a/session/",
      preferences: () => ({ notifications: { ...state.notifications }, titles: { ...state.titles } }),
      wanted: () => state.wanted,
      save: (enabled) => {
        state.wanted = enabled
      },
    })
  return { push: make(), make, state, calls, requests, browser, registration }
}

describe("push subscription lifecycle", () => {
  test("requests permission synchronously and registers through authenticated API before enabling", async () => {
    const f = fixture()
    const enable = f.push.enable()
    expect(f.calls).toEqual(["permission"])
    expect(f.push.state.enabled).toBe(false)
    await enable
    expect(f.push.state.enabled).toBe(true)
    expect(f.state.wanted).toBe(true)
    expect(f.requests.map((request) => [request.path, request.method])).toEqual([
      ["/api/push", "GET"],
      ["/api/push/subscription", "PUT"],
    ])
    expect(f.requests.every((request) => request.authorization === `Basic ${btoa("opencode:test-password")}`)).toBe(
      true,
    )
    expect(f.requests[1].body).toEqual({
      id: "browser-id",
      endpoint: "https://push.example/browser",
      keys: { p256dh: "p256dh", auth: "auth" },
      url: "https://app.example/server/server-a/session/",
      notifications: { agent: true, errors: false },
      titles: { agent: "Response ready", errors: "Session failed" },
    })
  })

  test("denied permission never registers or contacts a server", async () => {
    const f = fixture()
    f.state.granted = "denied"
    await f.push.enable()
    expect(f.push.state).toMatchObject({ enabled: false, busy: false, issue: "denied" })
    expect(f.calls).toEqual(["permission"])
    expect(f.state.wanted).toBe(false)
  })

  test("unsupported browsers never request permission or contact the server", async () => {
    const base = fixture()
    const f = fixture({ browser: { ...base.browser, issue: () => "unsupported" } })
    await f.push.enable()
    expect(f.push.state).toMatchObject({ enabled: false, issue: "unsupported" })
    expect(f.requests).toEqual([])
    expect(base.calls).toEqual([])
  })

  test("a failed PUT does not enable push or persist opt-in", async () => {
    const f = fixture()
    f.state.status = 503
    await f.push.enable()
    expect(f.push.state).toMatchObject({ enabled: false, issue: "failed" })
    expect(f.state.wanted).toBe(false)
    f.state.status = 204
    await f.push.enable()
    expect(f.push.state.enabled).toBe(true)
    expect(f.calls.filter((call) => call === "browser-subscribe")).toHaveLength(1)
  })

  test("old servers show unsupported without creating a browser subscription", async () => {
    const f = fixture()
    f.state.getStatus = 404
    await f.push.enable()
    expect(f.push.state.issue).toBe("serverUnsupported")
    expect(f.state.subscription).toBe(false)
  })

  test("restore verifies subscription and PUT; stale saved opt-in alone never enables", async () => {
    const f = fixture()
    f.state.wanted = true
    f.state.permission = "granted"
    await f.push.refresh()
    expect(f.push.state.enabled).toBe(false)
    expect(f.push.state.issue).toBe("subscription")
    expect(f.calls).not.toContain("permission")
    await f.push.enable()
    const reopened = f.make()
    expect(reopened.state.enabled).toBe(false)
    await reopened.refresh()
    expect(reopened.state.enabled).toBe(true)
    f.state.status = 503
    await reopened.refresh()
    expect(reopened.state.enabled).toBe(false)
  })

  test("refresh sends current categories and localized titles without asking permission", async () => {
    const f = fixture()
    await f.push.enable()
    f.state.notifications = { agent: false, errors: true }
    f.state.titles = { agent: "Antwort bereit", errors: "Sitzungsfehler" }
    await f.push.refresh()
    expect(f.requests.at(-1)?.body).toMatchObject({ notifications: f.state.notifications, titles: f.state.titles })
    expect(f.calls.filter((call) => call === "permission")).toHaveLength(1)
  })

  test("a synchronized opt-out restores local notifications without recreating the registration", async () => {
    const f = fixture()
    await f.push.enable()
    f.calls.length = 0
    f.state.wanted = false
    await f.push.refresh()
    expect(f.push.state.enabled).toBe(false)
    expect(f.calls).toEqual([])
  })

  test("disable removes server registration before browser unsubscribe", async () => {
    const f = fixture()
    await f.push.enable()
    f.calls.length = 0
    await f.push.disable()
    expect(f.calls).toEqual(["DELETE", "lookup:/push/server-a/", "browser-unsubscribe"])
    expect(f.requests.at(-1)?.path).toBe("/api/push/subscription/browser-id")
    expect(f.push.state.enabled).toBe(false)
    expect(f.state.wanted).toBe(false)
  })

  test("failed DELETE preserves the live subscription and enabled state", async () => {
    const f = fixture()
    await f.push.enable()
    f.state.deleteStatus = 503
    await f.push.disable()
    expect(f.push.state).toMatchObject({ enabled: true, issue: "failed" })
    expect(f.state.wanted).toBe(true)
    expect(f.state.subscription).toBe(true)
    expect(f.calls).not.toContain("browser-unsubscribe")
  })

  test("failed browser removal reports the failure even after server deletion", async () => {
    const f = fixture()
    await f.push.enable()
    f.state.unsubscribe = false
    await f.push.disable()
    expect(f.push.state).toMatchObject({ enabled: false, issue: "subscription" })
    expect(f.state.wanted).toBe(false)
    f.state.unsubscribe = true
    await f.push.disable()
    expect(f.state.subscription).toBe(false)
    expect(f.push.state.issue).toBeUndefined()
  })

  test("rotates stale VAPID keys only after deleting the old registration", async () => {
    const f = fixture()
    await f.push.enable()
    f.state.applicationServerKey = new Uint8Array([4, 5, 6]).buffer
    f.calls.length = 0
    await f.push.refresh()
    expect(f.calls).toEqual([
      "GET",
      "lookup:/push/server-a/",
      "DELETE",
      "browser-unsubscribe",
      "browser-subscribe",
      "PUT",
    ])
    expect(f.push.state.enabled).toBe(true)
  })

  test("does not swallow VAPID rotation failures", async () => {
    const f = fixture()
    await f.push.enable()
    f.state.applicationServerKey = new Uint8Array([4, 5, 6]).buffer
    f.state.deleteStatus = 503
    await f.push.refresh()
    expect(f.push.state).toMatchObject({ enabled: false, issue: "failed" })
    expect(f.calls).not.toContain("browser-unsubscribe")
  })

  test("keeps separate worker registrations for multiple servers", async () => {
    const first = fixture({ scope: "/push/server-a/", id: "id-a" })
    const second = fixture({ scope: "/push/server-b/", id: "id-b" })
    const registrations = new Map([
      ["/push/server-a/", first.registration],
      ["/push/server-b/", second.registration],
    ])
    const scopes: string[] = []
    const browser: PushBrowser = {
      ...first.browser,
      permission: () => "granted",
      register: async (scope) => {
        scopes.push(scope)
        return registrations.get(scope)!
      },
      registration: async (scope) => registrations.get(scope),
    }
    const a = fixture({ scope: "/push/server-a/", id: "id-a", browser })
    const b = fixture({ scope: "/push/server-b/", id: "id-b", browser })
    await Promise.all([a.push.enable(), b.push.enable()])
    expect(scopes).toEqual(["/push/server-a/", "/push/server-b/"])
    await a.push.disable()
    expect(b.push.state.enabled).toBe(true)
    expect(second.state.subscription).toBe(true)
    expect(first.state.subscription).toBe(false)
  })
})

test("push support requires secure context, browser APIs, and an installed iOS app", () => {
  const supported = { secure: true, supported: true, ios: false, installed: false }
  expect(pushSupport(supported)).toBeUndefined()
  expect(pushSupport({ ...supported, secure: false })).toBe("insecure")
  expect(pushSupport({ ...supported, supported: false })).toBe("unsupported")
  expect(pushSupport({ ...supported, ios: true, supported: false })).toBe("install")
  expect(pushSupport({ ...supported, ios: true, installed: true })).toBeUndefined()
})
