import { expect, jest, test } from "bun:test"
import { navigationDeadline } from "./navigation-deadline"

test("a page with no first document fails its waiter before the browser RPC deadline", async () => {
  jest.useFakeTimers()

  try {
    const never = Promise.withResolvers<void>()
    const failed = navigationDeadline(never.promise).catch(error => error.message)
    jest.advanceTimersByTime(15_000)
    expect(await failed).toContain("Reload the tab")
    expect(await navigationDeadline(Promise.resolve("loaded"))).toBe("loaded")
  } finally {
    jest.useRealTimers()
  }
})
