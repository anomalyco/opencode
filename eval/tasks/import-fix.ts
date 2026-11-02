import type { Task } from "../types"
import { PACKAGE_JSON } from "./shared"

export const importFix: Task = {
  id: "import-fix",
  category: "build-failure",
  prompt: [
    "bun test fails because src/main.ts imports a module that does not exist.",
    "Fix the import so the existing test passes.",
    "Do not change the test and do not move files.",
  ].join(" "),
  files: {
    "package.json": PACKAGE_JSON,
    "src/format.ts": [
      "export function formatName(name: string): string {",
      "  return name.trim()",
      "}",
      "",
    ].join("\n"),
    "src/main.ts": [
      'import { formatName } from "./utils/format"',
      "",
      "export function greet(name: string): string {",
      '  return "Hello, " + formatName(name) + "!"',
      "}",
      "",
    ].join("\n"),
    "src/main.test.ts": [
      'import { expect, test } from "bun:test"',
      'import { greet } from "./main"',
      "",
      'test("greets a trimmed name", () => {',
      '  expect(greet(" Ada ")).toBe("Hello, Ada!")',
      "})",
      "",
    ].join("\n"),
  },
  verify: {
    files: {
      "verify.test.ts": [
        'import { expect, test } from "bun:test"',
        'import { greet } from "../src/main"',
        "",
        'test("greeting behavior", () => {',
        '  expect(greet("Bob")).toBe("Hello, Bob!")',
        '  expect(greet("  ")).toBe("Hello, !")',
        "})",
        "",
      ].join("\n"),
    },
  },
  solution: {
    "src/main.ts": [
      'import { formatName } from "./format"',
      "",
      "export function greet(name: string): string {",
      '  return "Hello, " + formatName(name) + "!"',
      "}",
      "",
    ].join("\n"),
  },
}
