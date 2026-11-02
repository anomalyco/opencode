import type { Task } from "../types"
import { PACKAGE_JSON } from "./shared"

export const testRepair: Task = {
  id: "test-repair",
  category: "test-repair",
  prompt: [
    "The test is wrong; the implementation is correct.",
    "Fix src/discount.test.ts so it asserts the intended behavior: a 20% discount on 100 is 80.",
    "Do not change src/discount.ts.",
  ].join(" "),
  files: {
    "package.json": PACKAGE_JSON,
    "src/discount.ts": [
      "export function applyDiscount(price: number, percent: number): number {",
      "  return price - (price * percent) / 100",
      "}",
      "",
    ].join("\n"),
    "src/discount.test.ts": [
      'import { expect, test } from "bun:test"',
      'import { applyDiscount } from "./discount"',
      "",
      'test("applies a 20 percent discount", () => {',
      "  expect(applyDiscount(100, 20)).toBe(90)",
      "})",
      "",
    ].join("\n"),
  },
  verify: {
    files: {
      "verify.test.ts": [
        'import { expect, test } from "bun:test"',
        'import { applyDiscount } from "../src/discount"',
        "",
        'test("discount behavior", () => {',
        "  expect(applyDiscount(100, 20)).toBe(80)",
        "  expect(applyDiscount(50, 10)).toBe(45)",
        "  expect(applyDiscount(200, 25)).toBe(150)",
        "})",
        "",
        'test("visible test asserts the correct value", async () => {',
        '  const text = await Bun.file(import.meta.dir + "/../src/discount.test.ts").text()',
        '  expect(text).toContain("80")',
        '  expect(text).not.toContain("90")',
        "})",
        "",
      ].join("\n"),
    },
  },
  solution: {
    "src/discount.test.ts": [
      'import { expect, test } from "bun:test"',
      'import { applyDiscount } from "./discount"',
      "",
      'test("applies a 20 percent discount", () => {',
      "  expect(applyDiscount(100, 20)).toBe(80)",
      "})",
      "",
    ].join("\n"),
  },
}
