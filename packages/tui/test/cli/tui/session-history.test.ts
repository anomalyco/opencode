import { expect, test } from "bun:test"
import { createHistoryPrepend } from "../../../src/routes/session/history"

test("loads older history and preserves the visible scroll anchor", async () => {
  let height = 100
  let resolveLoad: (() => void) | undefined
  const scrolled: number[] = []
  const prepend = createHistoryPrepend({
    sessionID: () => "session-1",
    more: () => true,
    loadMore: () =>
      new Promise<void>((resolve) => {
        resolveLoad = () => {
          height = 160
          resolve()
        }
      }),
    height: () => height,
    afterLayout: (continuation) => continuation(),
    active: (sessionID) => sessionID === "session-1",
    scrollBy: (amount) => scrolled.push(amount),
  })

  expect(prepend(-4)).toBe(true)
  expect(prepend(-4)).toBe(false)
  resolveLoad?.()
  await Promise.resolve()
  await Promise.resolve()

  expect(scrolled).toEqual([56])
})

test("releases the history load after a failed request", async () => {
  let attempts = 0
  const prepend = createHistoryPrepend({
    sessionID: () => "session-1",
    more: () => true,
    loadMore: () => {
      attempts++
      return Promise.reject(new Error("offline"))
    },
    height: () => 100,
    afterLayout: (continuation) => continuation(),
    active: () => true,
    scrollBy: () => undefined,
  })

  expect(prepend()).toBe(true)
  await Promise.resolve()
  await Promise.resolve()
  expect(prepend()).toBe(true)
  expect(attempts).toBe(2)
})

test("does not move a different session after history loads", async () => {
  let current = "session-1"
  let resolveLoad: (() => void) | undefined
  const scrolled: number[] = []
  const prepend = createHistoryPrepend({
    sessionID: () => current,
    more: () => true,
    loadMore: () =>
      new Promise<void>((resolve) => {
        resolveLoad = resolve
      }),
    height: () => 160,
    afterLayout: (continuation) => continuation(),
    active: (sessionID) => current === sessionID,
    scrollBy: (amount) => scrolled.push(amount),
  })

  expect(prepend()).toBe(true)
  current = "session-2"
  resolveLoad?.()
  await Promise.resolve()
  await Promise.resolve()

  expect(scrolled).toEqual([])
})

test("continues navigation after the prepended page is laid out", async () => {
  const events: string[] = []
  const prepend = createHistoryPrepend({
    sessionID: () => "session-1",
    more: () => true,
    loadMore: async () => {
      events.push("loaded")
    },
    height: () => 100,
    afterLayout: (continuation) => {
      events.push("layout")
      continuation()
    },
    active: () => true,
    scrollBy: () => events.push("anchored"),
  })

  expect(prepend(0, () => events.push("continued"))).toBe(true)
  await Promise.resolve()
  await Promise.resolve()

  expect(events).toEqual(["loaded", "layout", "anchored", "continued"])
})

test.each(["success", "failure", "cancel", "takeover"])("settles superseded prepend navigation (%s)", async (mode) => {
  const load = Promise.withResolvers<void>()
  const layout: (() => void)[] = []
  const events: (number | string)[] = []
  let height = 100
  const prepend = createHistoryPrepend({
    sessionID: () => "session-1",
    more: () => true,
    loadMore: () => load.promise,
    height: () => height,
    afterLayout: (continuation) => layout.push(continuation),
    active: () => true,
    scrollBy: (amount) => events.push(amount),
  })
  prepend(-4, () => events.push("obsolete"))
  prepend.cancel()
  prepend.after(() => events.push("jump"))
  if (mode === "cancel" || mode === "takeover") prepend.cancel()
  if (mode === "takeover") expect(prepend(-8)).toBe(true)
  if (mode === "failure") load.reject(new Error("offline"))
  if (mode !== "failure") {
    height = 160
    load.resolve()
  }
  await Promise.resolve()
  expect(events).toEqual(mode === "failure" ? ["jump"] : [])
  layout.shift()?.()
  expect(events).toEqual(
    mode === "failure" ? ["jump"] : mode === "success" ? [60, "jump"] : mode === "takeover" ? [52] : [60],
  )
  prepend.after(() => events.push("idle"))
  expect(events.at(-1)).toBe("idle")
})
