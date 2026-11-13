import { expect, test } from "bun:test"
import { selectTip, type Tip } from "./queue"

const hours = 60 * 60 * 1000

// Installed an hour before time 0, so the first-tip delay has already passed.
const fresh = { current: "", shownAt: 0, dismissed: [], dismissedAt: 0, firstSeen: -hours }

const first: Tip = { id: "first", title: "tips.browse.title", description: "tips.browse.description" }

const second: Tip = { ...first, id: "second" }

const tips = [first, second]

test("the first tip waits an hour after the app first ran", () => {
  const installed = { ...fresh, firstSeen: 10 * hours }
  expect(selectTip(tips, installed, 11 * hours - 1)).toBeUndefined()
  expect(selectTip(tips, installed, 11 * hours)).toBe(first)
  expect(selectTip(tips, { ...fresh, firstSeen: 0 }, 5 * hours)).toBeUndefined()
  expect(selectTip(tips, { ...installed, dismissed: [first.id], dismissedAt: 1 }, 25 * hours)).toBe(second)
})

test("first eligible tip wins until it is handled or stops being eligible", () => {
  expect(selectTip(tips, fresh, 1)).toBe(first)
  expect(selectTip([{ ...first, when: () => false }, second], fresh, 1)).toBe(second)
  expect(selectTip(tips, { ...fresh, current: second.id, shownAt: 1 }, 24 * hours)).toBe(second)
})

test("handling starts a full day's wait and permanently skips that id", () => {
  const handled = { ...fresh, dismissedAt: hours, dismissed: [first.id] }
  expect(selectTip(tips, handled, 25 * hours - 1)).toBeUndefined()
  expect(selectTip(tips, handled, 25 * hours)).toBe(second)
  expect(selectTip([first], handled, 365 * 24 * hours)).toBeUndefined()
})

test("promo starts inclusively, expires even while shown, and cannot immediately yield to another tip", () => {
  const promo = { ...first, start: hours, end: hours + 1 }
  expect(selectTip([promo], fresh, hours - 1)).toBeUndefined()
  expect(selectTip([promo], fresh, hours)).toBe(promo)
  const shown = { ...fresh, current: promo.id, shownAt: hours }
  expect(selectTip([promo, second], shown, hours + 1)).toBeUndefined()
  expect(selectTip([promo, second], shown, 25 * hours)).toBe(second)
})
