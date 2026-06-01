import { describe, expect, test } from "bun:test"
import type { PromptInfo } from "../../../../src/cli/cmd/tui/component/prompt/history"
import { assign, expandTrackedPastedText, strip } from "../../../../src/cli/cmd/tui/component/prompt/part"

describe("prompt part", () => {
  test("strip removes persisted ids from reused file parts", () => {
    const part = {
      id: "prt_old",
      sessionID: "ses_old",
      messageID: "msg_old",
      type: "file" as const,
      mime: "image/png",
      filename: "tiny.png",
      url: "data:image/png;base64,abc",
    }

    expect(strip(part)).toEqual({
      type: "file",
      mime: "image/png",
      filename: "tiny.png",
      url: "data:image/png;base64,abc",
    })
  })

  test("assign overwrites stale runtime ids", () => {
    const part = {
      id: "prt_old",
      sessionID: "ses_old",
      messageID: "msg_old",
      type: "file" as const,
      mime: "image/png",
      filename: "tiny.png",
      url: "data:image/png;base64,abc",
    } as PromptInfo["parts"][number]

    const next = assign(part)

    expect(next.id).not.toBe("prt_old")
    expect(next.id.startsWith("prt_")).toBe(true)
    expect(next).toMatchObject({
      type: "file",
      mime: "image/png",
      filename: "tiny.png",
      url: "data:image/png;base64,abc",
    })
  })

  test("expandTrackedPastedText preserves wide characters around pasted text", () => {
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
    ).toBe(
      "你好你好\npublic:\n\tvoid ExecuteTask();\nprivate:\n阿斯顿法国红酒看来",
    )
  })

  test("expandTrackedPastedText only expands the tracked placeholder occurrence", () => {
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
