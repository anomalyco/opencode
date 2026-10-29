import { expect, test } from "bun:test"
import { groupID } from "../../../src/routes/session/anchors"
import type { GroupKind, SessionEntry, SessionRow } from "../../../src/routes/session/grouping/session"
import { groupEntries } from "../../../src/routes/session/grouping/tree"
import { rowsAfter, rowsBefore, rowWeight } from "../../../src/routes/session/mount-budget"

const read = (index: number): SessionEntry => ({
  type: "part",
  ref: { messageID: `m${index}`, partID: `read-${index}` },
})

function group(size: number, path: readonly GroupKind[] = ["exploration"]): SessionRow {
  const [node] = groupEntries(
    Array.from({ length: size }, (_, index) => read(index)),
    () => path,
  )
  if (node.type !== "group") throw new Error("Expected group")
  return node.kind === "reasoning" || node.kind === "instructions"
    ? { ...node, kind: node.kind, completed: true }
    : { ...node, kind: node.kind, pending: [], completed: true }
}

const collapsed = { expanded: () => false, grouped: () => true }

test("with every group collapsed each row costs one, matching the former row-count budget", () => {
  const rows: SessionRow[] = [
    { type: "message", messageID: "u" },
    group(200),
    group(3, ["reasoning"]),
    read(1),
    { type: "assistant-footer", messageID: "a" },
  ]
  const weights = rows.map((row) => rowWeight(row, collapsed))
  expect(weights).toEqual([1, 1, 1, 1, 1])
  for (const length of [0, 1, 39, 40, 41, 150]) {
    const ones = Array.from({ length }, () => 1)
    expect(rowsBefore(ones, length, 40)).toBe(Math.max(0, length - 40))
    for (const index of [0, Math.floor(length / 2), length]) {
      expect(rowsBefore(ones, index, 60)).toBe(Math.max(0, index - 60))
      expect(rowsAfter(ones, index, 60)).toBe(Math.min(length, index + 60))
    }
  }
})

test("an expanded group costs its header plus rendered children", () => {
  const row = group(200)
  if (row.type !== "group") throw new Error("Expected group")
  const id = groupID(row, 0)
  expect(rowWeight(row, { expanded: (key) => key === id, grouped: () => true })).toBe(201)
})

test("a collapsed inner group costs one even when its parent is expanded", () => {
  // The trailing sibling keeps the inner group nested rather than shown in its parent's place.
  const [row] = groupEntries(
    Array.from({ length: 51 }, (_, index) => read(index)),
    (entry) =>
      entry.type === "part" && entry.ref.partID === "read-50" ? ["exploration"] : ["exploration", "exploration"],
  )
  if (row.type !== "group" || row.children[0].type !== "group") throw new Error("Expected nested group")
  const outer = groupID(row, 0)
  const inner = groupID(row.children[0], 1)
  const weight = (expanded: (key: string) => boolean) =>
    rowWeight({ ...row, kind: "exploration", pending: [], completed: true }, { expanded, grouped: () => true })
  expect(weight((key) => key === outer)).toBe(3)
  expect(weight((key) => key === outer || key === inner)).toBe(53)
  // A saved expanded inner group under a collapsed parent mounts nothing.
  expect(weight((key) => key === inner)).toBe(1)
})

test("a lone inner group costs what it renders in its parent's place", () => {
  const row = group(50, ["activity", "exploration"])
  if (row.type !== "group" || row.children[0].type !== "group") throw new Error("Expected nested group")
  const outer = groupID(row, 0)
  const inner = groupID(row.children[0], 1)
  expect(rowWeight(row, collapsed)).toBe(1)
  expect(rowWeight(row, { expanded: (key) => key === inner, grouped: () => true })).toBe(51)
  // The parent isn't rendered, so its saved expansion mounts nothing extra.
  expect(rowWeight(row, { expanded: (key) => key === outer, grouped: () => true })).toBe(1)
  // An ungrouped inner kind stays wrapped, behind the parent's summary.
  expect(rowWeight(row, { expanded: () => false, grouped: (kind) => kind !== "exploration" })).toBe(1)
})

test("an ungrouped kind renders every leaf", () => {
  expect(rowWeight(group(12, ["reasoning"]), { expanded: () => false, grouped: (kind) => kind !== "reasoning" })).toBe(
    12,
  )
})

test("a heavy tail group leaves fewer older rows mounted", () => {
  const weights = [...Array.from({ length: 100 }, () => 1), 201, 1, 1]
  // The expanded group alone exceeds the tail budget.
  expect(rowsBefore(weights, weights.length, 40)).toBe(100)
  expect(rowsAfter(weights, 90, 60)).toBe(101)
})
