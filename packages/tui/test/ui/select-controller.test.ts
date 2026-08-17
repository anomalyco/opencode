import { expect, test } from "bun:test"
import {
  moveSelection,
  moveSelectionOffset,
  reconcileSelection,
  revealSelectionOffset,
} from "../../src/ui/select-controller"

test("reconciles and moves selections with explicit boundary policy", () => {
  expect([reconcileSelection(3, 0), reconcileSelection(4, 3), reconcileSelection(2, 6)]).toEqual([0, 2, 2])
  expect([
    moveSelection(0, { count: 3, delta: -1, policy: "clamp" }),
    moveSelection(2, { count: 3, delta: 1, policy: "clamp" }),
    moveSelection(0, { count: 3, delta: -1, policy: "wrap" }),
    moveSelection(2, { count: 3, delta: 1, policy: "wrap" }),
  ]).toEqual([0, 2, 2, 0])
})

test("reveals selections within bounded windows", () => {
  expect([
    revealSelectionOffset(5, { count: 20, limit: 8, selected: 3 }),
    revealSelectionOffset(3, { count: 20, limit: 8, selected: 11 }),
    revealSelectionOffset(3, { count: 20, limit: 8, selected: 10 }),
    revealSelectionOffset(20, { count: 20, limit: 8, selected: 19 }),
  ]).toEqual([3, 4, 3, 12])
})

test("keeps movement offsets and preview margins in bounds", () => {
  expect([
    moveSelectionOffset(0, { count: 20, limit: 8, selected: 6, direction: 1 }),
    moveSelectionOffset(8, { count: 20, limit: 8, selected: 9, direction: -1 }),
    moveSelectionOffset(12, { count: 20, limit: 8, selected: 19, direction: 1 }),
    moveSelectionOffset(4, { count: 4, limit: 8, selected: 3, direction: 1 }),
  ]).toEqual([1, 7, 12, 0])
})
