import { describe, expect, test } from "bun:test"
import { expandTrackedPastedText } from "../../src/prompt/part"

describe("prompt part", () => {
  test("preserves wide characters around pasted text", () => {
    const marker = "[Pasted ~3 lines]"
    const prefix = "你好你好\n"

    expect(
      expandTrackedPastedText(prefix + marker + "\n阿斯顿法国红酒看来", [
        {
          start: Bun.stringWidth("你好你好") + 1,
          end: Bun.stringWidth("你好你好") + 1 + Bun.stringWidth(marker),
          text: "public:\n\tvoid ExecuteTask();\nprivate:",
        },
      ]),
    ).toBe("你好你好\npublic:\n\tvoid ExecuteTask();\nprivate:\n阿斯顿法国红酒看来")
  })

  test("only expands the tracked placeholder occurrence", () => {
    const marker = "[Pasted ~3 lines]"
    const prefix = `keep ${marker} then `

    expect(
      expandTrackedPastedText(prefix + marker + " tail", [
        {
          start: Bun.stringWidth(prefix),
          end: Bun.stringWidth(prefix + marker),
          text: "alpha\nbeta\ngamma",
        },
      ]),
    ).toBe(`keep ${marker} then alpha\nbeta\ngamma tail`)
  })
})
