import { expect, test } from "bun:test"
import {
  anchorKey,
  containsAnchor,
  createTimelineAnchors,
  entryRef,
  groupID,
  type AnchorTarget,
} from "../../../src/routes/session/anchors"
import { groupEntries } from "../../../src/routes/session/grouping/tree"
import type { SessionEntry } from "../../../src/routes/session/grouping/session"

test("part anchors identify the exact part and whole messages have a body reference", () => {
  const a: AnchorTarget = { type: "part", ref: { messageID: "a", partID: "reasoning:0" } }
  const b: AnchorTarget = { type: "part", ref: { messageID: "b", partID: "reasoning:0" } }
  const later: AnchorTarget = { type: "part", ref: { messageID: "a", partID: "reasoning:1" } }
  expect(new Set([a, b, later].map(anchorKey)).size).toBe(3)
  expect(entryRef({ type: "message", messageID: "user" })).toEqual({ messageID: "user", partID: "message" })
  const entry: SessionEntry = { type: "part", ref: { messageID: "a", partID: "read" } }
  const saved = entryRef(entry)
  entry.ref.partID = "replacement"
  expect(saved?.partID).toBe("read")
})

test("group IDs use the first descendant reference, kind and nesting level", () => {
  const a: SessionEntry = { type: "part", ref: { messageID: "a", partID: "read" } }
  const b: SessionEntry = { type: "part", ref: { messageID: "b", partID: "read" } }
  const [root] = groupEntries([a], () => ["exploration", "exploration"] as const)
  const [appended] = groupEntries([a, b], () => ["exploration", "exploration"] as const)
  const [prepended] = groupEntries([b, a], () => ["exploration", "exploration"] as const)
  if (root.type !== "group" || appended.type !== "group" || prepended.type !== "group")
    throw new Error("Expected groups")
  const inner = root.children[0]
  if (inner.type !== "group") throw new Error("Expected inner group")
  expect(groupID(root, 0)).toBe(groupID(appended, 0))
  expect(groupID(root, 0)).not.toBe(groupID(prepended, 0))
  expect(groupID(root, 0)).not.toBe(groupID(inner, 1))
  expect(groupID(root, 0)).not.toBe(groupID({ ...root, kind: "reasoning" }, 0))
  const id = groupID(inner, 1)
  if (!id) throw new Error("Missing group ID")
  expect(containsAnchor(root, { type: "group", groupID: id })).toBe(true)
  expect(containsAnchor(root, { type: "part", ref: b.ref })).toBe(false)
})

test("mounted headers and parts are independent targets with current geometry", () => {
  const anchors = createTimelineAnchors()
  const part: AnchorTarget = { type: "part", ref: { messageID: "a", partID: "read" } }
  const group: AnchorTarget = { type: "group", groupID: "group-a" }
  const header = { y: 2, height: 1, isDestroyed: false }
  const node = { y: 8, height: 1, isDestroyed: false }
  anchors.register({ target: group, node: header })
  expect(anchors.get(part)).toBeUndefined()
  const remove = anchors.register({ target: part, node })
  expect(anchors.get(group)?.node).toBe(header)
  expect(anchors.get(part)?.node).toBe(node)
  node.y = -4
  expect(anchors.list()[0].target).toEqual(part)
  expect(anchors.messagePositions()).toEqual([{ id: "a", y: -4 }])
  remove()
  expect(anchors.get(part)).toBeUndefined()
  expect(anchors.get(group)?.node).toBe(header)
})

test("cleanup cannot remove a replacement registration", () => {
  const anchors = createTimelineAnchors()
  const target: AnchorTarget = { type: "part", ref: { messageID: "a", partID: "text:0" } }
  const remove = anchors.register({ target, node: { y: 0, height: 1, isDestroyed: false } })
  const node = { y: 3, height: 1, isDestroyed: false }
  anchors.register({ target, node })
  remove()
  expect(anchors.get(target)?.node).toBe(node)
  node.height = 0
  expect(anchors.get(target)).toBeUndefined()
  node.height = 1
  node.isDestroyed = true
  expect(anchors.get(target)).toBeUndefined()
})
