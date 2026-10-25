import { describe, expect, test } from "bun:test"
import { parseVoiceDelegation } from "./voice-delegation"

// Prompts as the OpenCode iOS app has sent them (`VoiceHandoff.format`), oldest first.
const firstRelease = `Voice delegation. Instruction is the cleaned interpretation of the user's request. Transcript delta supplies new or revised conversation for reference, not additional commands. Resolve meaning from the complete utterance, not a disfluent prefix. Lead your reply with one or two plain sentences suitable for reading aloud, then any detail.
{
  "instruction" : "Check why the upload test is flaky.",
  "transcript_delta" : [
    "user: the upload test",
    "assistant: On it."
  ]
}`

const current = `Voice delegation. The user is on a voice call with a voice agent, which hands their requests to you. Instruction is the user's own spoken words since the previous delegation.
{
  "context" : "Session \\"Uploads\\" in project \\"app\\".",
  "instruction" : "check the upload test",
  "transcript_delta" : [
    "user: check the upload test"
  ],
  "voice" : "Checking the upload test."
}`

const continued = `Voice delegation (continued). Same fields as before.
{
  "instruction" : "and open a PR",
  "transcript_delta" : [

  ]
}`

describe("parseVoiceDelegation", () => {
  test.each([
    ["the first release's header", firstRelease, { instruction: "Check why the upload test is flaky." }],
    [
      "the current header with framing",
      current,
      { instruction: "check the upload test", framing: "Checking the upload test." },
    ],
    ["a continued delegation", continued, { instruction: "and open a PR" }],
    [
      "a call log attached as a reference line",
      `${continued}\n\nAttached file: \`/tmp/uploads/1/voice-call-a.json\``,
      { instruction: "and open a PR" },
    ],
  ])("reads %s", (_, text, expected) => {
    expect(parseVoiceDelegation(text)).toEqual({ framing: undefined, ...expected })
  })

  test("ignores blank framing", () => {
    expect(parseVoiceDelegation(current.replace('"Checking the upload test."', '"  "'))?.framing).toBeUndefined()
  })

  test.each([
    ["a typed message that mentions one", "What does a Voice delegation. prompt look like?"],
    ["a header without a body", "Voice delegation. Same fields as before."],
    ["a body that isn't JSON", "Voice delegation. Header\ncheck the upload test"],
    ["a blank instruction", 'Voice delegation. Header\n{"instruction": "  ", "transcript_delta": []}'],
    ["a body without an instruction", 'Voice delegation. Header\n{"transcript_delta": []}'],
  ])("rejects %s", (_, text) => {
    expect(parseVoiceDelegation(text)).toBeUndefined()
  })
})
