import { expect, mock, test } from "bun:test"
import { runInNewContext } from "node:vm"

const script = await Bun.file(new URL("../../../public/push-sw.js", import.meta.url)).text()

type PushPayload = {
  title?: string | number
  url?: string
  tag?: string
  kind?: string
}

type ShownNotification = {
  body: string
  silent: boolean
  tag?: string
  renotify: boolean
  data: { url?: string; kind?: string }
}

type Listener = (event: {
  notification?: { data?: { url?: string }; close(): void }
  data?: { json(): PushPayload }
  waitUntil(promise: Promise<unknown>): void
}) => void

function worker(input: { scope?: string; clients?: { url: string }[] } = {}) {
  const listeners = new Map<string, Listener>()
  const notifications: ShownNotification[] = []
  const opened: string[] = []

  const self = {
    location: { origin: "https://opencode.test" },
    registration: {
      scope: input.scope ?? "https://opencode.test/push/a2V5/",
      showNotification: async (_title: string, options: ShownNotification) => {
        notifications.push(options)
      },
    },
    skipWaiting: async () => undefined,
    clients: {
      matchAll: async () => input.clients ?? [],
      openWindow: async (url: string) => {
        opened.push(url)
      },
    },
    addEventListener: (type: string, listener: Listener) => {
      listeners.set(type, listener)
    },
  }

  runInNewContext(script, { self, URL, Promise })

  return { listeners, notifications, opened }
}

function dispatch(listener: Listener | undefined, event: Parameters<Listener>[0]) {
  if (!listener) throw new Error("Missing listener")
  const pending: Promise<unknown>[] = []
  listener({ ...event, waitUntil: (promise) => pending.push(promise) })

  return Promise.all(pending)
}

test.each([true, false])("notification click reuses a matching app window (already open: %s)", async (open) => {
  const url = "https://opencode.test/server/a2V5/session/ses_test"
  const focus = mock(async () => undefined)
  const navigate = mock(async (_url: string) => ({ focus }))
  const other = { url: "https://opencode.test/settings", focus: mock(async () => undefined) }
  const matching = { url, focus, navigate }
  const close = mock(() => undefined)
  const { listeners, opened } = worker({ clients: [other, ...(open ? [matching] : [])] })

  await dispatch(listeners.get("notificationclick"), {
    notification: { data: { url }, close },
    waitUntil: () => undefined,
  })

  expect(close).toHaveBeenCalledTimes(1)
  expect(other.focus).not.toHaveBeenCalled()
  expect(navigate.mock.calls).toEqual([])
  expect(focus).toHaveBeenCalledTimes(open ? 1 : 0)
  expect(opened).toEqual(open ? [] : [url])
})

test("notification click ignores destinations on another origin", async () => {
  const { listeners, opened } = worker()
  const close = mock(() => undefined)

  await dispatch(listeners.get("notificationclick"), {
    notification: { data: { url: "https://evil.example/server/a2V5/session/ses_test" }, close },
    waitUntil: () => undefined,
  })

  expect(close).toHaveBeenCalledTimes(1)
  expect(opened).toEqual([])
})

test("push always displays a notification and keeps a safe click target", async () => {
  const { listeners, notifications } = worker()
  await dispatch(listeners.get("push"), {
    data: {
      json: () => ({
        title: "Input needed",
        url: "https://opencode.test/server/a2V5/session/ses_test",
        tag: "ses_test",
        kind: "questions",
      }),
    },
    waitUntil: () => undefined,
  })

  expect(notifications).toEqual([
    expect.objectContaining({
      silent: false,
      tag: "ses_test",
      renotify: true,
      data: { url: "https://opencode.test/server/a2V5/session/ses_test", kind: "questions" },
    }),
  ])
})

test("push falls back to a generic notification for malformed payloads", async () => {
  const { listeners, notifications } = worker()
  await dispatch(listeners.get("push"), {
    data: { json: () => ({ title: 7, url: "https://evil.example/session" }) },
    waitUntil: () => undefined,
  })

  expect(notifications).toEqual([expect.objectContaining({ body: "", data: { url: undefined, kind: undefined } })])
})
