import type { Task } from "../types"
import { PACKAGE_JSON } from "./shared"

const math = (leftName: string, rightName: string) => [
  "export function " + leftName + "(left: number, right: number) {",
  "  return left + right",
  "}",
  "",
  "export function " + rightName + "(left: number, right: number) {",
  "  return left - right",
  "}",
  "",
].join("\n")

const app = (name: string) => [
  'import { ' + name + ' } from "./math"',
  "",
  "export function total(values: number[]) {",
  "  return values.reduce((sum, value) => " + name + "(sum, value), 0)",
  "}",
  "",
].join("\n")

const index = (leftName: string, rightName: string) => [
  'export { ' + leftName + ", " + rightName + ' } from "./math"',
  'export { total } from "./app"',
  "",
].join("\n")

const test = (leftName: string, rightName: string) => [
  'import { expect, test } from "bun:test"',
  'import { ' + leftName + ", " + rightName + ', total } from "./index"',
  "",
  'test("math api", () => {',
  "  expect(" + leftName + "(2, 3)).toBe(5)",
  "  expect(" + rightName + "(5, 3)).toBe(2)",
  "  expect(total([1, 2, 3])).toBe(6)",
  "})",
  "",
].join("\n")

export const renameApi: Task = {
  id: "rename-api",
  category: "refactor",
  prompt: [
    "Rename the exported API add to plus and sub to minus everywhere, including call sites and tests.",
    "Keep behavior unchanged and do not add compatibility aliases.",
    "The package must continue to pass bun test.",
  ].join(" "),
  files: {
    "package.json": PACKAGE_JSON,
    "src/math.ts": math("add", "sub"),
    "src/app.ts": app("add"),
    "src/index.ts": index("add", "sub"),
    "src/math.test.ts": test("add", "sub"),
  },
  verify: {
    files: {
      "verify.test.ts": [
        'import { expect, test } from "bun:test"',
        'import * as api from "../src/index"',
        "",
        'test("renamed api", () => {',
        "  expect(api.plus(2, 3)).toBe(5)",
        "  expect(api.minus(5, 3)).toBe(2)",
        "  expect(api.total([1, 2, 3])).toBe(6)",
        '  expect("add" in api).toBe(false)',
        '  expect("sub" in api).toBe(false)',
        "})",
        "",
      ].join("\n"),
    },
  },
  solution: {
    "src/math.ts": math("plus", "minus"),
    "src/app.ts": app("plus"),
    "src/index.ts": index("plus", "minus"),
    "src/math.test.ts": test("plus", "minus"),
  },
}
