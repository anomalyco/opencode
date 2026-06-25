import { describe, expect, test } from "bun:test"
import { restoreSessionScrollPosition, shouldResumeSessionAutoScroll } from "./session-scroll"

describe("session scroll restoration", () => {
  test("does not resume auto-scroll when a session scroll position was saved", () => {
    expect(
      shouldResumeSessionAutoScroll({
        locationHash: "",
        messageId: undefined,
        pendingMessage: undefined,
        savedScroll: { x: 0, y: 0 },
      }),
    ).toBe(false)
  })

  test("resumes auto-scroll when there is no saved session scroll position", () => {
    expect(
      shouldResumeSessionAutoScroll({
        locationHash: "",
        messageId: undefined,
        pendingMessage: undefined,
        savedScroll: undefined,
      }),
    ).toBe(true)
  })

  test("restores a saved position and marks it away from the bottom", () => {
    expect(
      restoreSessionScrollPosition({
        savedScroll: { x: 25, y: 300 },
        clientWidth: 400,
        clientHeight: 500,
        scrollWidth: 900,
        scrollHeight: 1200,
      }),
    ).toEqual({
      x: 25,
      y: 300,
      awayFromBottom: true,
    })
  })
})
