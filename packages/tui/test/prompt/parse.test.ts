import { expect, test } from "bun:test"
import { formatFileLineRange, mentionLineRange, parseFileLineRange, parseSlashHead } from "../../src/prompt/parse"

test("parses a bare line as a single-line range", () => {
  expect([
    parseFileLineRange("src/app.ts#12"),
    parseFileLineRange("src/app.ts#12-12"),
    parseFileLineRange("src/app.ts#12-20"),
    parseFileLineRange("src/app.ts#12-"),
    parseFileLineRange("src/app.ts#20-12"),
    parseFileLineRange("src/app.ts#bad"),
    parseFileLineRange("src/app.ts"),
  ]).toEqual([
    { base: "src/app.ts", lineRange: { startLine: 12, endLine: 12 } },
    { base: "src/app.ts", lineRange: { startLine: 12, endLine: 12 } },
    { base: "src/app.ts", lineRange: { startLine: 12, endLine: 20 } },
    { base: "src/app.ts", lineRange: { startLine: 12, endLine: undefined } },
    { base: "src/app.ts", lineRange: { startLine: 20, endLine: 20 } },
    { base: "src/app.ts" },
    { base: "src/app.ts" },
  ])
})

test("renders a one-line mention apart from an open-ended one", () => {
  expect(formatFileLineRange("src/app.ts", { startLine: 12, endLine: 12 })).toBe("src/app.ts#12")
  expect(formatFileLineRange("src/app.ts", { startLine: 12, endLine: 20 })).toBe("src/app.ts#12-20")
  expect(formatFileLineRange("src/app.ts", { startLine: 12, endLine: undefined })).toBe("src/app.ts#12-")
})

test("keeps the end line of a single-line editor selection", () => {
  expect(mentionLineRange(10, 10)).toEqual({ startLine: 10, endLine: 10 })
  expect(mentionLineRange(10, 14)).toEqual({ startLine: 10, endLine: 14 })
})

test("keeps frontend-specific slash separators", () => {
  expect(parseSlashHead("/editor\rfirst")).toEqual({ name: "editor\rfirst", arguments: "", end: 13 })
  expect(parseSlashHead("/editor\rfirst", /\s/)).toEqual({ name: "editor", arguments: "first", end: 7 })
  expect(parseSlashHead("editor")).toBeUndefined()
})
