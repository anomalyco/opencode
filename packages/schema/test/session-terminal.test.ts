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
        native: { promptFeedback: { blockReason: "SAFETY" } },
      }),
    ),
  ).toMatchObject({
    finish: "content-filter",
    rawFinish: "SAFETY",
    native: { promptFeedback: { blockReason: "SAFETY" } },
  })
  const legacy = SessionMessage.persisted({
    ...assistant,
    providerState: { promptFeedback: { blockReason: "SAFETY" } },
    content: [{ type: "text", text: "hello", state: { signature: "sig" } }],
  })
  expect(decode(legacy)).toMatchObject({
    native: { promptFeedback: { blockReason: "SAFETY" } },
    content: [{ type: "text", native: { signature: "sig" } }],
  })
  expect(encode(decode(legacy))).not.toHaveProperty("providerState")
  expect(SessionMessage.persisted(assistant)).toBe(assistant)
})
