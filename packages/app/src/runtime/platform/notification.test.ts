import { expect, mock, test } from "bun:test"
import { runInNewContext } from "node:vm"

const script = await Bun.file(new URL("../../../public/notification.js", import.meta.url)).text()

test.each([true, false])("notification click opens its session (already open: %s)", async (open) => {
  const url = "https://opencode.test/server/test/session/completed"
  const focus = mock(async () => undefined)
  const other = { url: "https://opencode.test/", focus: mock(async () => undefined) }
  const navigate = mock(async (_url: string) => ({ focus }))
  const openWindow = mock(async (_url: string) => undefined)
  const close = mock(() => undefined)
  const pending: Promise<unknown>[] = []
  const addEventListener = mock(
    (
      _type: string,
      _listener: (event: {
        notification: { data: { url: string }; close(): void }
        waitUntil(promise: Promise<unknown>): void
      }) => void,
    ) => undefined,
  )
  runInNewContext(script, {
    self: {
      addEventListener,
      clients: {
        matchAll: async () => [other, ...(open ? [{ url, focus, navigate }] : [])],
        openWindow,
      },
    },
  })
  expect(addEventListener.mock.calls[0][0]).toBe("notificationclick")
  addEventListener.mock.calls[0][1]({
    notification: { data: { url }, close },
    waitUntil: (promise) => pending.push(promise),
  })
  expect(pending).toHaveLength(1)
  await Promise.all(pending)
  expect(close).toHaveBeenCalledTimes(1)
  expect(other.focus).not.toHaveBeenCalled()
  expect(navigate.mock.calls).toEqual(open ? [[url]] : [])
  expect(focus).toHaveBeenCalledTimes(open ? 1 : 0)
  expect(openWindow.mock.calls).toEqual(open ? [] : [[url]])
})
