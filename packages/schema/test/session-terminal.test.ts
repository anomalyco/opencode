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

test("provider compaction context is optional, versioned and JSON-only", () => {
  const decode = Schema.decodeUnknownSync(SessionEvent.Compaction.Ended.data)
  const encode = Schema.encodeSync(SessionEvent.Compaction.Ended.data)
  const local = { sessionID: "ses_context", reason: "manual" as const, text: "summary", recent: "" }
  expect(encode({ ...decode(local), providerContext: undefined })).toEqual(local)
  const providerContext = {
    version: 1 as const,
    provenance: {
      providerID: "openai",
      provider: "openai",
      modelID: "deployment",
      route: "responses",
      protocol: "responses",
      endpoint: "digest",
    },
    messages: [{ role: "assistant", content: [{ type: "compaction", provider: "openai", encrypted: "opaque" }] }],
  }
  expect(encode(decode({ ...local, providerContext }))).toEqual({ ...local, providerContext })
  expect(() => decode({ ...local, providerContext: { ...providerContext, version: 2 } })).toThrow()
  expect(() => decode({ ...local, providerContext: { ...providerContext, messages: [() => "invalid"] } })).toThrow()
})
