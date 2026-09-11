import { expect, test } from "bun:test"
import { createMessageAnchors } from "../../../src/routes/session/message-anchors"

test("chooses the first logical entry rather than mount order", () => {
  const anchors = createMessageAnchors()
  const later = { y: 30, isDestroyed: false }
  const first = { y: 10, isDestroyed: false }
  anchors.register({ messageID: "a", target: later, path: () => [2], level: 1 })
  anchors.register({ messageID: "a", target: first, path: () => [0, 1], level: 2 })
  expect(anchors.get("a")?.target).toBe(first)
})

test("prefers a revealed leaf over its group fallback and restores the fallback on unmount", () => {
  const anchors = createMessageAnchors()
  const group = { y: 4, isDestroyed: false }
  const leaf = { y: 12, isDestroyed: false }
  anchors.register({ messageID: "a", target: group, path: () => [0, 0, 1], level: 1, reveal: () => true })
  const remove = anchors.register({ messageID: "a", target: leaf, path: () => [0, 0, 1], level: 3 })
  expect(anchors.get("a")?.target).toBe(leaf)
  remove()
  expect(anchors.get("a")?.target).toBe(group)
  expect(anchors.get("a")?.reveal?.()).toBe(true)
})

test("reads current order and renderer positions after prepend, reflow and scrolling", () => {
  const anchors = createMessageAnchors()
  let index = 2
  const target = { y: 20, isDestroyed: false }
  anchors.register({ messageID: "a", target, path: () => [index], level: 1 })
  anchors.register({ messageID: "b", target: { y: 10, isDestroyed: false }, path: () => [1], level: 1 })
  expect(anchors.list().map((anchor) => anchor.messageID)).toEqual(["b", "a"])
  index = 0
  target.y = -5
  expect(anchors.list().map((anchor) => anchor.messageID)).toEqual(["a", "b"])
  expect(anchors.get("a")?.target.y).toBe(-5)
})

test("cleanup removes only its own registration and destroyed renderables are ignored", () => {
  const anchors = createMessageAnchors()
  const old = { y: 0, isDestroyed: false }
  const replacement = { y: 1, isDestroyed: false }
  const remove = anchors.register({ messageID: "a", target: old, path: () => [0], level: 1 })
  anchors.register({ messageID: "a", target: replacement, path: () => [0], level: 1 })
  remove()
  remove()
  expect(anchors.get("a")?.target).toBe(replacement)
  replacement.isDestroyed = true
  expect(anchors.get("a")).toBeUndefined()
  expect(anchors.list()).toEqual([])
})
