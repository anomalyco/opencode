import { afterEach, describe, expect, jest, test } from "bun:test"
import { createRoot } from "solid-js"
import { createTabTitleDisclosure } from "../../src/component/session-tabs"

afterEach(() => jest.useRealTimers())

describe("session tab title disclosure", () => {
  test("shows a delayed tooltip only when the title overflows", () => {
    jest.useFakeTimers()
    const scope = createRoot((dispose) => ({ disclosure: createTabTitleDisclosure(), dispose }))
    const state = {
      sessionID: "first",
      title: "A long session title",
      x: 4,
      y: 1,
      maxWidth: 40,
      align: "start" as const,
    }

    scope.disclosure.enter(state, 8)
    expect(scope.disclosure.hovered()).toBe("first")
    expect(scope.disclosure.tooltip()).toBeUndefined()
    jest.advanceTimersByTime(600)
    expect(scope.disclosure.tooltip()).toEqual(state)

    scope.disclosure.enter({ ...state, sessionID: "second", title: "Short" }, 8)
    jest.advanceTimersByTime(600)
    expect(scope.disclosure.tooltip()).toBeUndefined()
    scope.dispose()
  })

  test("dismisses the tooltip immediately", () => {
    jest.useFakeTimers()
    const scope = createRoot((dispose) => ({ disclosure: createTabTitleDisclosure(), dispose }))
    const state = {
      sessionID: "first",
      title: "A long session title",
      x: 4,
      y: 1,
      maxWidth: 40,
      align: "start" as const,
    }

    scope.disclosure.enter(state, 8)
    jest.advanceTimersByTime(600)
    scope.disclosure.leave("first")

    expect(scope.disclosure.hovered()).toBeUndefined()
    expect(scope.disclosure.tooltip()).toBeUndefined()
    scope.dispose()
  })
})
