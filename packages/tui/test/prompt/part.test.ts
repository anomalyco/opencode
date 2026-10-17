import { expect, test } from "bun:test"
import { measureEditText } from "@opentui/core"
import { expandTrackedPastedText } from "../../src/prompt/part"

const widthMethod = "wcwidth"
const measure = (text: string) => measureEditText(text, { widthMethod })

const marker = "[Pasted ~3 lines]"
const pasted = "public:\n\tvoid ExecuteTask();\nprivate:"

// Each row lists the text around the tracked placeholders, so a row of n pieces tracks n - 1 of them.
test.each([
  ["你好👨‍👩‍👧你好\n", "\n阿斯顿法国红酒看来"],
  [`keep ${marker} then `, " tail"],
  ["\f\t\x85\x7f\r\n", "\0"],
  ["", "", "\f中", ""],
])("expands only the tracked placeholders after %j", (...pieces) => {
  const ranges = pieces.slice(1).map((_, index) => {
    const before = pieces.slice(0, index + 1).join(marker)
    return { start: measure(before), end: measure(before + marker), text: pasted }
  })
  expect(expandTrackedPastedText(pieces.join(marker), ranges, widthMethod)).toBe(pieces.join(pasted))
})
