import { expect, test } from "bun:test"
import { Schema } from "effect"
import { SessionInbox } from "../src/session-inbox.js"

test("queued selections round trip and absent selections stay omitted", () => {
  const decode = Schema.decodeUnknownSync(SessionInbox.UserPayload)
  const encode = Schema.encodeSync(SessionInbox.UserPayload)
  expect(encode({ ...decode({ text: "Legacy input" }), agent: undefined, model: undefined })).toEqual({
    text: "Legacy input",
  })
  const input = { text: "Plan next", agent: "plan", model: { providerID: "demo", id: "model", variant: "high" } }
  expect(encode(decode(input))).toEqual(input)
})
