import { expect, test } from "bun:test"
import { Schema } from "effect"
import { SessionMessage } from "../src/session-message.js"
import { SessionEvent } from "../src/session-event.js"
import { SessionTransfer } from "../src/session-transfer.js"
import { Model } from "../src/model.js"

const checkpoint = {
  id: "msg_checkpoint",
  type: "compaction",
  status: "completed",
  reason: "manual",
  summary: "Summary",
  recent: "",
  time: { created: 1 },
} as const
const model = Model.Ref.parse("provider/model#variant")

test("completed compactions require a model and preserve optional opaque provider state", () => {
  const decode = Schema.decodeUnknownSync(SessionMessage.CompactionCompleted)
  const encode = Schema.encodeSync(SessionMessage.CompactionCompleted)
  expect(() => decode(checkpoint)).toThrow()
  expect(encode({ ...decode({ ...checkpoint, model }), providerState: undefined })).toEqual({ ...checkpoint, model })
  const providerState = { responseId: "response", nested: { opaque: [1, "value"] } }
  expect(encode(decode({ ...checkpoint, model, providerState }))).toEqual({ ...checkpoint, model, providerState })
})

test("compaction completion events require the producing model", () => {
  const decode = Schema.decodeUnknownSync(SessionEvent.Compaction.Ended.data)
  const data = { sessionID: "ses_checkpoint", reason: "manual", text: "Summary", recent: "" } as const
  expect(() => decode(data)).toThrow()
  expect(Schema.encodeSync(SessionEvent.Compaction.Ended.data)(decode({ ...data, model }))).toEqual({ ...data, model })
})

test("only the import boundary accepts a historical checkpoint without a model", () => {
  const data = {
    info: {
      id: "ses_checkpoint",
      projectID: "global",
      location: { directory: "/project" },
      cost: 0,
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      time: { created: 1, updated: 1 },
    },
    messages: [checkpoint],
  }
  expect(() => Schema.decodeUnknownSync(SessionTransfer.Import)(data)).not.toThrow()
  expect(() => Schema.decodeUnknownSync(SessionTransfer.Data)(data)).toThrow()
})
