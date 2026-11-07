import { expect, test } from "bun:test"
import { append, groupRefs, hasPart, partitionPending, type SessionRow } from "../../../src/routes/session/grouping/session"

test("a pending tool does not hide a later tool reusing its call ID in another message", () => {
  const rows: SessionRow[] = []
  const blocked = { messageID: "assistant-a", partID: "call-reused" }
  const later = { messageID: "assistant-b", partID: "call-reused" }
  append(rows, blocked, { type: "tool", name: "read" })
  partitionPending(rows, new Set([blocked.partID]))
  append(rows, later, { type: "tool", name: "read" })

  const group = rows[0]
  if (group.type !== "group" || group.kind !== "exploration") throw new Error("Expected exploration group")
  expect(groupRefs(group)).toEqual([later])
  expect(group.pending).toEqual([blocked])
  expect(groupRefs(group, true)).toEqual([later, blocked])

  partitionPending(rows, new Set())
  expect(groupRefs(group)).toEqual([later, blocked])
  expect(group.pending).toEqual([])
})

test("hasPart finds parts in groups, including blocked ones, and misses other messages", () => {
  const rows: SessionRow[] = []
  const blocked = { messageID: "assistant-a", partID: "call-1" }
  const read = { messageID: "assistant-a", partID: "call-2" }
  const text = { messageID: "assistant-a", partID: "text-1" }
  append(rows, blocked, { type: "tool", name: "read" })
  partitionPending(rows, new Set([blocked.partID]))
  append(rows, read, { type: "tool", name: "read" })
  append(rows, text, { type: "text" })

  expect(hasPart(rows, blocked)).toBe(true)
  expect(hasPart(rows, read)).toBe(true)
  expect(hasPart(rows, text)).toBe(true)
  expect(hasPart(rows, { messageID: "assistant-b", partID: "call-1" })).toBe(false)
  expect(hasPart([], text)).toBe(false)
})

test("hasPart finds parts in nested low-verbosity activity groups", () => {
  const rows: SessionRow[] = []
  const thought = { messageID: "assistant-a", partID: "thought-1" }
  const read = { messageID: "assistant-a", partID: "call-1" }
  append(rows, thought, { type: "reasoning" }, rows.length, "low")
  append(rows, read, { type: "tool", name: "read" }, rows.length, "low")

  expect(rows[0]?.type).toBe("group")
  expect(hasPart(rows, thought)).toBe(true)
  expect(hasPart(rows, read)).toBe(true)
  expect(hasPart(rows, { messageID: "assistant-a", partID: "call-2" })).toBe(false)
})
