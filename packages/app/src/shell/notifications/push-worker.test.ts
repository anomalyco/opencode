import { expect, test } from "bun:test"
import { runInNewContext } from "node:vm"

const script = await Bun.file(new URL("../../../public/push-sw.js", import.meta.url)).text()
const url = "https://app.example/server/server-a/session/ses_123"

type WindowClient = { url: string; focus(): Promise<unknown>; navigate(url: string): Promise<WindowClient | null> }

function worker(windows: WindowClient[] = []) {
  const handlers = new Map<string, (event: object) => void>()
  const shown: { title: string; options: NotificationOptions }[] = []
  const opened: string[] = []
  const pending: Promise<unknown>[] = []
  runInNewContext(script, {
    URL,
    self: {
      location: { origin: "https://app.example" },
      registration: {
        scope: "https://app.example/push/server-a/",
        showNotification: async (title: string, options: NotificationOptions) => {
          shown.push({ title, options })
        },
      },
      addEventListener: (name: string, handler: (event: object) => void) => handlers.set(name, handler),
      skipWaiting: async () => {},
      clients: {
        matchAll: async (options: object) => {
          expect(options).toEqual({ type: "window", includeUncontrolled: true })
          return windows
        },
        openWindow: async (url: string) => {
          opened.push(url)
        },
      },
    },
  })
  return {
    shown,
    opened,
    async send(name: string, event: object) {
      handlers.get(name)!({ ...event, waitUntil: (promise: Promise<unknown>) => pending.push(promise) })
      await Promise.all(pending.splice(0))
    },
  }
}

test("push displays payload even if a window is already open", async () => {
  const sw = worker()
  await sw.send("push", {
    data: { json: () => ({ title: "Response ready", body: "Session title", url, tag: "evt_1" }) },
  })
  expect(sw.shown).toEqual([
    { title: "Response ready", options: { body: "Session title", tag: "evt_1", data: { url } } },
  ])
})

test("malformed or empty push is still user-visible, not a silent background fetch", async () => {
  const sw = worker()
  await sw.send("push", {
    data: {
      json: () => {
        throw new Error("invalid JSON")
      },
    },
  })
  await sw.send("push", {})
  expect(sw.shown.map((notification) => notification.title)).toEqual(["OpenCode", "OpenCode"])
  expect(sw.shown.every((notification) => notification.options.data.url === undefined)).toBe(true)
})

test("worker rejects cross-origin, cross-server and non-session notification URLs", async () => {
  const sw = worker()
  for (const unsafe of [
    "https://evil.example/server/server-a/session/ses_123",
    "https://app.example/server/server-b/session/ses_123",
    "https://app.example/settings",
    "https://app.example/server/server-a/session/../settings",
    "https://app.example/server/server-a/session/a%2Fb",
    `${url}?token=secret`,
    `https://user:password@app.example/server/server-a/session/ses_123`,
  ]) {
    await sw.send("push", { data: { json: () => ({ title: "Done", body: "Title", url: unsafe }) } })
    expect(sw.shown.at(-1)?.options.data.url).toBeUndefined()
    await sw.send("notificationclick", { notification: { data: { url: unsafe }, close: () => {} } })
  }
  expect(sw.opened).toEqual([])
})

test("click navigates and focuses an existing same-server window, never another server", async () => {
  const calls: string[] = []
  const current: WindowClient = {
    url: "https://app.example/server/server-a/session/ses_old",
    focus: async () => {
      calls.push("focus")
    },
    navigate: async (value) => {
      calls.push(value)
      return current
    },
  }
  const other: WindowClient = {
    url: "https://app.example/server/server-b/session/ses_other",
    focus: async () => {
      throw new Error("wrong server")
    },
    navigate: async () => {
      throw new Error("wrong server")
    },
  }
  const sw = worker([other, current])
  await sw.send("notificationclick", { notification: { data: { url }, close: () => calls.push("close") } })
  expect(calls).toEqual(["close", url, "focus"])
  expect(sw.opened).toEqual([])
})

test("click prefers the exact session without reloading it", async () => {
  const calls: string[] = []
  const current: WindowClient = {
    url,
    focus: async () => {
      calls.push("focus")
    },
    navigate: async () => {
      throw new Error("unnecessary navigation")
    },
  }
  const sw = worker([current])
  await sw.send("notificationclick", { notification: { data: { url }, close: () => {} } })
  expect(calls).toEqual(["focus"])
})

test("click opens the session when the app is closed", async () => {
  const sw = worker()
  await sw.send("notificationclick", { notification: { data: { url }, close: () => {} } })
  expect(sw.opened).toEqual([url])
})
