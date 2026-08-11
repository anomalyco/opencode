import { expect, test } from "bun:test"
import { DateTime, Effect } from "effect"
import { SessionMessage } from "@opencode-ai/core/session/message"
import { SessionMessageRow } from "@opencode-ai/core/session/message-row"

const message = SessionMessage.Synthetic.make({
  id: SessionMessage.ID.make("msg_row"),
  type: "synthetic",
  text: "hello",
  time: { created: DateTime.makeUnsafe(1_000) },
})

test("round trips the persisted message representation", async () => {
  const row = SessionMessageRow.encode(message)

  expect(row.id).toBe(message.id)
  expect(row.type).toBe(message.type)
  expect(row.data).toHaveProperty("text", message.text)
  expect(row.data).toHaveProperty("time.created", 1_000)
  expect(await Effect.runPromise(SessionMessageRow.decode(row))).toEqual(message)
  expect(SessionMessageRow.decodeSync(row)).toEqual(message)
})

test("canonical columns override stale values in message data", () => {
  const row = SessionMessageRow.encode(message)
  const data = {
    ...row.data,
    id: SessionMessage.ID.make("msg_stale"),
    type: "system" as const,
  }

  expect(SessionMessageRow.decodeSync({ ...row, data })).toEqual(message)
})
