import type { Task } from "../types"
import { PACKAGE_JSON } from "./shared"

const implementation = [
  "export function slugify(input: string): string {",
  "  return input",
  "    .trim()",
  "    .toLowerCase()",
  '    .replace(/[^\\p{L}\\p{N}]+/gu, "-")',
  '    .replace(/^-+|-+$/g, "")',
  "}",
  "",
].join("\n")

export const slugify: Task = {
  id: "slugify",
  category: "feature",
  prompt: [
    "Implement slugify in src/slug.ts.",
    "It should lowercase, trim, replace each run of characters that are not Unicode letters or numbers with a single hyphen, and trim leading and trailing hyphens.",
    "Examples: 'Hello World' -> 'hello-world', '  Café déjà vu! ' -> 'café-déjà-vu', 'A--B__C' -> 'a-b-c'.",
    "Do not change the test.",
  ].join(" "),
  files: {
    "package.json": PACKAGE_JSON,
    "src/slug.ts": [
      "export function slugify(input: string): string {",
      '  throw new Error("not implemented")',
      "}",
      "",
    ].join("\n"),
    "src/slug.test.ts": [
      'import { expect, test } from "bun:test"',
      'import { slugify } from "./slug"',
      "",
      'test("lowercases and joins words", () => {',
      '  expect(slugify("Hello World")).toBe("hello-world")',
      "})",
      "",
    ].join("\n"),
  },
  verify: {
    files: {
      "verify.test.ts": [
        'import { expect, test } from "bun:test"',
        'import { slugify } from "../src/slug"',
        "",
        'test("slug rules", () => {',
        '  expect(slugify("  Café déjà vu! ")).toBe("café-déjà-vu")',
        '  expect(slugify("A--B__C")).toBe("a-b-c")',
        '  expect(slugify("---")).toBe("")',
        '  expect(slugify("Hello,  World!")).toBe("hello-world")',
        "})",
        "",
      ].join("\n"),
    },
  },
  solution: {
    "src/slug.ts": implementation,
  },
}
