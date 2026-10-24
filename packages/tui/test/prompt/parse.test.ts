import { expect, test } from "bun:test"
import { parseFileLineRange, parseSlashHead } from "../../src/prompt/parse"

test("preserves file line-range parsing semantics", () => {
  expect([
    parseFileLineRange("src/app.ts#12-20"),
    parseFileLineRange("src/app.ts#12"),
    parseFileLineRange("src/app.ts#12-"),
    parseFileLineRange("src/app.ts#12-12"),
    parseFileLineRange("src/app.ts#12-10"),
    parseFileLineRange("src/app.ts#bad"),
    parseFileLineRange("src/app.ts"),
  ]).toEqual([
    { base: "src/app.ts", lineRange: { startLine: 12, endLine: 20 } },
    { base: "src/app.ts", lineRange: { startLine: 12, endLine: undefined } },
    { base: "src/app.ts", lineRange: { startLine: 12, endLine: undefined } },
    { base: "src/app.ts", lineRange: { startLine: 12, endLine: 12 } },
    { base: "src/app.ts", lineRange: { startLine: 12, endLine: undefined } },
    { base: "src/app.ts" },
    { base: "src/app.ts" },
  ])
})

test("keeps frontend-specific slash separators", () => {
  expect(parseSlashHead("/editor\rfirst")).toEqual({ name: "editor\rfirst", arguments: "", end: 13 })
  expect(parseSlashHead("/editor\rfirst", /\s/)).toEqual({ name: "editor", arguments: "first", end: 7 })
  expect(parseSlashHead("editor")).toBeUndefined()
})

test.each([1, 12])("preserves an explicit single-line range on line %s", (line) => {
  expect(parseFileLineRange(`src/app.ts#${line}-${line}`)).toEqual({
    base: "src/app.ts",
    lineRange: { startLine: line, endLine: line },
  })
})
