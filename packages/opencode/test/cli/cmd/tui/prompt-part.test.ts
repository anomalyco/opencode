import { describe, expect, test } from "bun:test"
import type { PromptInfo } from "../../../../src/cli/cmd/tui/component/prompt/history"
import { assign, expandPastedTextPlaceholders, strip } from "../../../../src/cli/cmd/tui/component/prompt/part"

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

  test("expandPastedTextPlaceholders preserves wide characters around pasted text", () => {
    const parts = [
      {
        type: "text" as const,
        text: "public:\n\tvoid ExecuteTask();\nprivate:",
        source: {
          text: {
            start: 8,
            end: 26,
            value: "[Pasted ~3 lines]",
          },
        },
      },
    ] satisfies PromptInfo["parts"]

    expect(expandPastedTextPlaceholders("你好你好\n[Pasted ~3 lines]\n阿斯顿法国红酒看来", parts)).toBe(
      "你好你好\npublic:\n\tvoid ExecuteTask();\nprivate:\n阿斯顿法国红酒看来",
    )
  })
})
