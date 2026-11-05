import { expect, test } from "bun:test"
import { parseVoiceDelegation } from "@/session/timeline/voice-delegation"
import { continuedHeader, formatHandoff, header } from "./handoff"

const input = {
  instruction: "Check why the upload test is flaky.",
  transcript: ["user: um the upload test is flaky again", "assistant: Checking."],
  context: 'Session "Uploads" in project "app".',
}

test("writes the iOS handoff: header line, then sorted pretty-printed JSON without a voice field", () => {
  expect(formatHandoff({ ...input, full: true })).toBe(`${header}
{
  "context": "Session \\"Uploads\\" in project \\"app\\".",
  "instruction": "Check why the upload test is flaky.",
  "transcript_delta": [
    "user: um the upload test is flaky again",
    "assistant: Checking."
  ]
}`)
})

test.each([true, false])("reads back what it writes (full header: %p)", (full) => {
  const text = formatHandoff({ ...input, full })

  expect(text.startsWith(full ? header : continuedHeader)).toBe(true)
  expect(parseVoiceDelegation(text)).toEqual({ instruction: input.instruction, framing: undefined })
})

test("omits an empty context", () => {
  const text = formatHandoff({ instruction: "Hi", transcript: [], context: " ", full: false })

  expect(text).toBe(`${continuedHeader}\n{\n  "instruction": "Hi",\n  "transcript_delta": []\n}`)
  expect(parseVoiceDelegation(text)).toEqual({ instruction: "Hi", framing: undefined })
})
