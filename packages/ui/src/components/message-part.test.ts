import { describe, expect, test } from "bun:test"
import type { Part, TextPart } from "@opencode-ai/sdk/v2"
import { skillText } from "./message-skill"

function text(part: Partial<TextPart> = {}): TextPart {
  return {
    id: "part_1",
    sessionID: "ses_1",
    messageID: "msg_1",
    type: "text",
    text: "value",
    ...part,
  }
}

describe("message-part skillText", () => {
  test("returns synthetic skill template text", () => {
    const parts: Part[] = [
      text({ text: "user input" }),
      text({
        id: "part_2",
        text: "skill template",
        synthetic: true,
        metadata: { kind: "skill-template" },
      }),
    ]

    expect(skillText(parts)?.text).toBe("skill template")
  })

  test("ignores unrelated synthetic text", () => {
    const parts: Part[] = [
      text({
        id: "part_2",
        text: 'Called the Read tool with the following input: {"filePath":"/tmp/x"}',
        synthetic: true,
      }),
    ]

    expect(skillText(parts)).toBeUndefined()
  })
})
