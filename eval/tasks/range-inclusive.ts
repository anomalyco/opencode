import type { Task } from "../types"
import { PACKAGE_JSON } from "./shared"

export const rangeInclusive: Task = {
  id: "range-inclusive",
  category: "bug-fix",
  prompt: [
    "The test in src/range.test.ts fails.",
    "Fix src/range.ts so range(start, end) includes both endpoints.",
    "If start is greater than end, return an empty array.",
    "Do not change the test. Run the test to confirm.",
  ].join(" "),
  files: {
    "package.json": PACKAGE_JSON,
    "src/range.ts": [
      "export function range(start: number, end: number): number[] {",
      "  const values: number[] = []",
      "  for (let value = start; value < end; value++) values.push(value)",
      "  return values",
      "}",
      "",
    ].join("\n"),
    "src/range.test.ts": [
      'import { expect, test } from "bun:test"',
      'import { range } from "./range"',
      "",
      'test("includes both endpoints", () => {',
      "  expect(range(2, 4)).toEqual([2, 3, 4])",
      "})",
      "",
    ].join("\n"),
  },
  verify: {
    files: {
      "verify.test.ts": [
        'import { expect, test } from "bun:test"',
        'import { range } from "../src/range"',
        "",
        'test("inclusive range", () => {',
        "  expect(range(2, 4)).toEqual([2, 3, 4])",
        "  expect(range(0, 0)).toEqual([0])",
        "  expect(range(-2, 1)).toEqual([-2, -1, 0, 1])",
        "  expect(range(3, 1)).toEqual([])",
        "})",
        "",
      ].join("\n"),
    },
  },
  solution: {
    "src/range.ts": [
      "export function range(start: number, end: number): number[] {",
      "  const values: number[] = []",
      "  for (let value = start; value <= end; value++) values.push(value)",
      "  return values",
      "}",
      "",
    ].join("\n"),
  },
}
