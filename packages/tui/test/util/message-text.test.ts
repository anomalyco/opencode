import { describe, expect, test } from "bun:test"
import type { Part, TextPart } from "@opencode-ai/sdk/v2"
import { messageText } from "../../src/util/message-text"

function text(value: string, synthetic = false): TextPart {
  return { id: "prt_test", messageID: "msg_test", sessionID: "ses_test", type: "text", text: value, synthetic }
}

describe("messageText", () => {
  test("preserves every character inside a single prompt part", () => {
    const prompt = "  Read-only medium research.\n\nDo not read .env files.\n\tKeep C:\\project\\file.ts exact.  "
    expect(messageText([text(prompt)])).toBe(prompt)
  })

  test("keeps displayed paragraph separators when copying multiple parts", () => {
    expect(messageText([text("Read-only medium"), text("research.")])).toBe("Read-only medium\n\nresearch.")
  })

  test("excludes synthetic, empty and non-text parts without extra separators", () => {
    const parts: Part[] = [
      text("First paragraph"),
      text("Hidden instructions", true),
      text(""),
      {
        id: "prt_file",
        messageID: "msg_test",
        sessionID: "ses_test",
        type: "file",
        mime: "text/plain",
        url: "file:///fixture.ts",
      },
      text("Second paragraph"),
    ]
    expect(messageText(parts)).toBe("First paragraph\n\nSecond paragraph")
  })

  test("does not guess spaces inside an already malformed prompt", () => {
    expect(messageText([text("Read-only mediumresearch.")])).toBe("Read-only mediumresearch.")
  })

  test("handles messages with no visible text", () => {
    expect(messageText([])).toBe("")
    expect(messageText([text(""), text("Hidden instructions", true)])).toBe("")
  })
})
