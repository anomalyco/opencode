import { expect, mock, test } from "bun:test"
import { runInNewContext } from "node:vm"

const script = await Bun.file(new URL("../../../public/notification.js", import.meta.url)).text()

type Listener = (event: {
  notification: { data?: { url?: string }; close(): void }
  waitUntil(promise: Promise<unknown>): void
}) => void

type WindowClient = {
  url: string
  focus(): Promise<void>
  navigate?(url: string): Promise<{ focus(): Promise<void> } | undefined>
}

function worker(clients: WindowClient[]) {
  const listeners = new Map<string, Listener>()
  const opened: string[] = []

  const self = {
    location: { origin: "https://opencode.test" },
    addEventListener: (type: string, listener: Listener) => {
      listeners.set(type, listener)
    },
    clients: {
      matchAll: async () => clients,
      openWindow: async (url: string) => {
        opened.push(url)

        return undefined
      },
    },
  }

  runInNewContext(script, { self, URL, Promise })

  return { listeners, opened }
}

function click(listener: Listener | undefined, url: string) {
  if (!listener) throw new Error("Missing notificationclick listener")
  const close = mock(() => undefined)
  const pending: Promise<unknown>[] = []
  listener({
    notification: { data: { url }, close },
    waitUntil: (promise) => pending.push(promise),
  })

  return { close, done: Promise.all(pending) }
}

test("notification click focuses an exact session tab", async () => {
  const url = "https://opencode.test/server/a2V5/session/ses_test"
  const focus = mock(async () => undefined)
  const other = { url: "https://opencode.test/settings", focus: mock(async () => undefined) }
  const { listeners, opened } = worker([other, { url, focus }])
  const { close, done } = click(listeners.get("notificationclick"), url)

  await done

  expect(close).toHaveBeenCalledTimes(1)
  expect(focus).toHaveBeenCalledTimes(1)
  expect(other.focus).not.toHaveBeenCalled()
  expect(opened).toEqual([])
})

test("notification click opens the session when no app window exists", async () => {
  const url = "https://opencode.test/server/a2V5/session/ses_test"
  const { listeners, opened } = worker([])
  const { done } = click(listeners.get("notificationclick"), url)

  await done

  expect(opened).toEqual([url])
})

test("notification click navigates an existing app window to the session", async () => {
  const url = "https://opencode.test/server/a2V5/session/ses_test"
  const focus = mock(async () => undefined)
  const navigate = mock(async (_url: string) => ({ focus }))
  const { listeners, opened } = worker([{ url: "https://opencode.test/settings", focus, navigate }])
  const { done } = click(listeners.get("notificationclick"), url)

  await done

  expect(navigate.mock.calls).toEqual([[url]])
  expect(focus).toHaveBeenCalledTimes(1)
  expect(opened).toEqual([])
})

test("notification click ignores another origin and non-session routes", async () => {
  const { listeners, opened } = worker([])

  await click(listeners.get("notificationclick"), "https://evil.example/server/a2V5/session/ses_test").done
  await click(listeners.get("notificationclick"), "https://opencode.test/settings").done

  expect(opened).toEqual([])
})
