import { expect, test } from "bun:test"
import { Schema } from "effect"
import { SessionEvent } from "../src/session-event.js"
import { SessionMessage } from "../src/session-message.js"

const assistant = {
  id: "msg_terminal",
  type: "assistant" as const,
  agent: "build",
  model: { providerID: "openai", id: "gpt-test" },
  content: [],
  time: { created: 0 },
}

test("assistant terminal diagnostics remain optional and round trip", () => {
  const decode = Schema.decodeUnknownSync(SessionMessage.Assistant)
  const encode = Schema.encodeSync(SessionMessage.Assistant)

  expect(encode(decode(assistant))).toEqual(assistant)
  expect(
    encode(
      decode({
        ...assistant,
        finish: "content-filter",
        rawFinish: "SAFETY",
        providerState: { promptFeedback: { blockReason: "SAFETY" } },
      }),
    ),
  ).toMatchObject({
    finish: "content-filter",
    rawFinish: "SAFETY",
    providerState: { promptFeedback: { blockReason: "SAFETY" } },
  })
})

test("failed steps only override the assistant finish for content filters", () => {
  const decode = Schema.decodeUnknownSync(SessionEvent.Step.Failed.data)
  const input = {
    sessionID: "ses_terminal",
    assistantMessageID: "msg_terminal",
    error: { type: "provider.content-filter", message: "Blocked" },
  }

  expect(decode(input)).toMatchObject(input)
  expect(decode({ ...input, finish: "content-filter", rawFinish: "SAFETY" })).toMatchObject({
    finish: "content-filter",
    rawFinish: "SAFETY",
  })
  expect(() => decode({ ...input, finish: "stop" })).toThrow()
})
