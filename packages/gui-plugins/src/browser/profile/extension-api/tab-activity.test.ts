import { expect, test } from "bun:test"
import { createTabActivity } from "./tab-activity"

test("a popup in a minimized window leaves on selection change without a second hide event", () => {
  const activity = createTabActivity()
  activity.activated(1, 7)
  activity.hidden(7)
  let closed = 0
  const release = activity.watch(1, 7, () => closed++)
  activity.activated(2, 8)
  activity.activated(1, 7)
  expect(closed).toBe(0)
  activity.activated(1, 9)
  expect(closed).toBe(1)
  release()
  activity.hidden(7)
  expect(closed).toBe(1)
})
