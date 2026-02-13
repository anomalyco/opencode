import { describe, expect, test } from "bun:test"
import { handleNotificationClick } from "./notification-click"

describe("notification click", () => {
  test("focuses and navigates when href exists", () => {
    const calls: string[] = []
    handleNotificationClick("/abc/session/123", {
      focus: () => calls.push("focus"),
      location: {
        assign: (href) => calls.push(href),
      },
    })
    expect(calls).toEqual(["focus", "/abc/session/123"])
  })

  test("only focuses when href is missing", () => {
    const calls: string[] = []
    handleNotificationClick(undefined, {
      focus: () => calls.push("focus"),
      location: {
        assign: (href) => calls.push(href),
      },
    })
    expect(calls).toEqual(["focus"])
  })
})
