import { describe, expect, test } from "bun:test"
import { markCurrentNotifications, type Notification } from "./notification-state"

describe("notification", () => {
  test("marks only matching session notifications in the active directory as viewed", () => {
    const list: Notification[] = [
      { type: "turn-complete", time: 1, viewed: false, session: "a", directory: "/x" },
      { type: "error", time: 2, viewed: false, session: "a", directory: "/y", error: { name: "UnknownError", data: { message: "boom" } } },
      { type: "turn-complete", time: 3, viewed: false, session: "b", directory: "/x" },
      { type: "turn-complete", time: 4, viewed: true, session: "a", directory: "/x" },
    ]

    const next = markCurrentNotifications(list, "a", "/x")

    expect(next).not.toBe(list)
    expect(next[0]?.viewed).toBe(true)
    expect(next[1]?.viewed).toBe(false)
    expect(next[2]?.viewed).toBe(false)
    expect(next[3]?.viewed).toBe(true)
  })

  test("returns the original list when nothing matches", () => {
    const list: Notification[] = [{ type: "turn-complete", time: 1, viewed: false, session: "a", directory: "/x" }]

    expect(markCurrentNotifications(list, "b", "/x")).toBe(list)
    expect(markCurrentNotifications(list, "a", "/y")).toBe(list)
  })
})
