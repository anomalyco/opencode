import { describe, expect, test } from "bun:test"
import type { Part, TextPart } from "@opencode-ai/sdk/v2"
import { skillText } from "./message-skill"
import { streamsplit } from "./message-part-stream"

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

describe("message-part streamsplit", () => {
  test("keeps completed paragraphs in the stable head", () => {
    expect(streamsplit("Alpha $$x^2$$\n\nBeta")).toEqual({
      head: "Alpha $$x^2$$",
      tail: "Beta",
    })
  })

  test("keeps completed fenced blocks in the stable head", () => {
    expect(streamsplit("```ts\nconst x = 1\n```\nnext")).toEqual({
      head: "```ts\nconst x = 1\n```",
      tail: "next",
    })
  })

  test("leaves unfinished streaming text in the tail", () => {
    expect(streamsplit("Alpha $$x^2$$")).toEqual({
      head: "",
      tail: "Alpha $$x^2$$",
    })
  })
})
