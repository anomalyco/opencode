import { describe, expect, test } from "bun:test"
import { buildNotificationIndex } from "./notification-index"

type Notification = {
  type: "turn-complete" | "error"
  session: string
  directory: string
  viewed: boolean
  time: number
}

const turn = (session: string, directory: string, viewed = false): Notification => ({
  type: "turn-complete",
  session,
  directory,
  viewed,
  time: 1,
})

const error = (session: string, directory: string, viewed = false): Notification => ({
  type: "error",
  session,
  directory,
  viewed,
  time: 1,
})

describe("buildNotificationIndex", () => {
  test("builds unseen counts and unseen error flags", () => {
    const list = [
      turn("s1", "d1", false),
      error("s1", "d1", false),
      turn("s1", "d1", true),
      turn("s2", "d1", false),
      error("s3", "d2", true),
    ]

    const index = buildNotificationIndex(list)

    expect(index.session.all.get("s1")?.length).toBe(3)
    expect(index.session.unseen.get("s1")?.length).toBe(2)
    expect(index.session.unseenCount.get("s1")).toBe(2)
    expect(index.session.unseenHasError.get("s1")).toBe(true)

    expect(index.session.unseenCount.get("s2")).toBe(1)
    expect(index.session.unseenHasError.get("s2") ?? false).toBe(false)
    expect(index.session.unseenCount.get("s3") ?? 0).toBe(0)
    expect(index.session.unseenHasError.get("s3") ?? false).toBe(false)

    expect(index.project.unseenCount.get("d1")).toBe(3)
    expect(index.project.unseenHasError.get("d1")).toBe(true)
    expect(index.project.unseenCount.get("d2") ?? 0).toBe(0)
    expect(index.project.unseenHasError.get("d2") ?? false).toBe(false)
  })

  test("updates selectors after viewed transitions", () => {
    const list = [turn("s1", "d1", false), error("s1", "d1", false), turn("s2", "d1", false)]
    const next = list.map((item) => (item.session === "s1" ? { ...item, viewed: true } : item))

    const before = buildNotificationIndex(list)
    const after = buildNotificationIndex(next)

    expect(before.session.unseenCount.get("s1")).toBe(2)
    expect(before.session.unseenHasError.get("s1")).toBe(true)
    expect(before.project.unseenCount.get("d1")).toBe(3)
    expect(before.project.unseenHasError.get("d1")).toBe(true)

    expect(after.session.unseenCount.get("s1") ?? 0).toBe(0)
    expect(after.session.unseenHasError.get("s1") ?? false).toBe(false)
    expect(after.project.unseenCount.get("d1")).toBe(1)
    expect(after.project.unseenHasError.get("d1") ?? false).toBe(false)
  })
})
