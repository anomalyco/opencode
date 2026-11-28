import { expect, test } from "bun:test"
import { NOTIFICATION_LIMIT, showNotification, type ShownNotification } from "./notifications"

const from = (extension: string, count: number) => Array.from({ length: count }, (_, at) => ({ extension, id: `n${at}` }))

const shownAfter = (items: readonly ShownNotification[]) =>
  items.reduce<{ shown: readonly ShownNotification[]; closed: ShownNotification[] }>(
    (current, item) => {
      const next = showNotification(current.shown, item)

      return { shown: next.shown, closed: [...current.closed, ...next.closed] }
    },
    { shown: [], closed: [] },
  )

test("an extension that shows 50 notifications keeps the last 10, and the oldest closed first", () => {
  const result = shownAfter(from("flood", 50))

  expect(NOTIFICATION_LIMIT).toBe(10)
  expect(result.shown).toEqual(from("flood", 50).slice(40))
  expect(result.closed).toEqual(from("flood", 50).slice(0, 40))
})

test("the limit counts every extension's notifications, so a flood closes another extension's oldest too", () => {
  const result = shownAfter([...from("quiet", 2), ...from("flood", 9)])

  expect(result.closed).toEqual([{ extension: "quiet", id: "n0" }])
  expect(result.shown).toHaveLength(10)
})

test("showing an id again replaces its notification instead of counting it twice, and it becomes the newest", () => {
  const ten = from("one", 10)
  const next = showNotification(ten, { extension: "one", id: "n0" })

  expect(next.closed).toEqual([])
  expect(next.shown).toEqual([...ten.slice(1), { extension: "one", id: "n0" }])

  // The same id from another extension is another notification.
  expect(showNotification(ten, { extension: "two", id: "n0" }).closed).toEqual([{ extension: "one", id: "n0" }])
})
