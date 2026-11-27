import { expect, jest, test } from "bun:test"
import { NAVIGATION_DEADLINE_MS, navigationDeadline, navigationProgressDeadline } from "./navigation-deadline"

test("a page with no first document fails its waiter before the browser RPC deadline", async () => {
  jest.useFakeTimers()

  try {
    const never = Promise.withResolvers<void>()
    const outcome = { failed: "" }
    const failed = navigationDeadline(never.promise).catch((error: Error) => (outcome.failed = error.message))
    // The deadline a pane uses unless it is given another: 15 seconds, not a moment less.
    expect(NAVIGATION_DEADLINE_MS).toBe(15_000)
    jest.advanceTimersByTime(14_999)
    await Promise.resolve()
    expect(outcome.failed).toBe("")
    jest.advanceTimersByTime(1)
    expect(await failed).toContain("Reload the tab")
    expect(await navigationDeadline(Promise.resolve("loaded"))).toBe("loaded")
    // A given deadline replaces it.
    const short = navigationDeadline(never.promise, 300).catch((error: Error) => error.message)
    jest.advanceTimersByTime(300)
    expect(await short).toContain("Reload the tab")
  } finally {
    jest.useRealTimers()
  }
})

test("navigationProgressDeadline distinguishes committed-but-still-loading from uncommitted no-progress", async () => {
  jest.useFakeTimers()

  try {
    // 1. Committed document still loading subresources settles cleanly as still_loading instead of failing.
    const committedWork = Promise.withResolvers<void>()
    const stillLoading = navigationProgressDeadline(committedWork.promise, () => true, 300)
    jest.advanceTimersByTime(300)
    expect(await stillLoading).toBe("still_loading")

    // 2. Uncommitted navigation (true no-progress) still rejects with NavigationDeadlineError.
    const hungWork = Promise.withResolvers<void>()
    const failed = navigationProgressDeadline(hungWork.promise, () => false, 300).catch((error: Error) => error.message)
    jest.advanceTimersByTime(300)
    expect(await failed).toContain("Reload the tab")

    // 3. Completed load before deadline resolves as completed.
    expect(await navigationProgressDeadline(Promise.resolve(), () => true, 300)).toBe("completed")
  } finally {
    jest.useRealTimers()
  }
})
