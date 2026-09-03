import { expect, test } from "bun:test"
import { Schema } from "effect"
import { SessionMessage } from "../src/session-message.js"
import { SessionEvent } from "../src/session-event.js"
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

test("completed compactions preserve optional model and provider state without changing old records", () => {
  const decode = Schema.decodeUnknownSync(SessionMessage.CompactionCompleted)
  const encode = Schema.encodeSync(SessionMessage.CompactionCompleted)
  expect(encode({ ...decode(checkpoint), model: undefined, providerState: undefined })).toEqual(checkpoint)
  const providerState = { responseId: "response", nested: { opaque: [1, "value"] } }
  expect(encode(decode({ ...checkpoint, model, providerState }))).toEqual({ ...checkpoint, model, providerState })
})

test("compaction completion events remain compatible without model or provider state", () => {
  const decode = Schema.decodeUnknownSync(SessionEvent.Compaction.Ended.data)
  const data = { sessionID: "ses_checkpoint", reason: "manual", text: "Summary", recent: "" } as const
  expect(Schema.encodeSync(SessionEvent.Compaction.Ended.data)(decode(data))).toEqual(data)
  expect(Schema.encodeSync(SessionEvent.Compaction.Ended.data)(decode({ ...data, model }))).toEqual({ ...data, model })
})
