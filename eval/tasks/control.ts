import type { Task } from "../types"
import { PACKAGE_JSON } from "./shared"

export const control: Task = {
  id: "control",
  category: "control",
  default: false,
  seeded: false,
  prompt:
    "Control task. No changes are needed. Do not modify files, do not run commands, and do not use tools. Reply with a short confirmation.",
  files: {
    "package.json": PACKAGE_JSON,
    "src/add.ts": ["export function add(left: number, right: number): number {", "  return left + right", "}", ""].join(
      "\n",
    ),
    "src/add.test.ts": [
      'import { expect, test } from "bun:test"',
      'import { add } from "./add"',
      "",
      'test("adds", () => {',
      "  expect(add(2, 3)).toBe(5)",
      "})",
      "",
    ].join("\n"),
  },
  verify: {
    files: {
      "verify.test.ts": [
        'import { expect, test } from "bun:test"',
        'import { add } from "../src/add"',
        "",
        'test("add behavior", () => {',
        "  expect(add(-1, 1)).toBe(0)",
        "})",
        "",
      ].join("\n"),
    },
  },
  solution: {
    "src/add.ts": ["export function add(left: number, right: number): number {", "  return left + right", "}", ""].join(
      "\n",
    ),
  },
}
