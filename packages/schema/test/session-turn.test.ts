import { expect, test } from "bun:test"
import { Schema } from "effect"
import { SessionTurn } from "../src/session-turn.js"

const input = { sessionID: "ses_result", inputID: "msg_input" }
const turn = {
  ...input,
  turnID: input.inputID,
  inputIDs: [input.inputID],
  cost: 0,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
}
const decode = Schema.decodeUnknownSync(SessionTurn.Info)
const encode = Schema.encodeSync(SessionTurn.Info)

test("pending results need no turn and terminal results omit an absent assistant message", () => {
  expect(encode(decode({ ...input, status: "pending" }))).toEqual({ ...input, status: "pending" })
  const result = decode({ ...turn, status: "settled" })
  if (result.status === "pending") throw new Error("Expected a turn result")
  expect(encode({ ...result, assistantMessageID: undefined })).toEqual({
    ...turn,
    status: "settled",
  })
})

test("failed and interrupted results require their typed outcome", () => {
  const failed = { ...turn, status: "failed" as const, error: { type: "aborted", message: "Stopped" } }
  expect(encode(decode(failed))).toEqual(failed)
  expect(() => decode({ ...turn, status: "failed" })).toThrow()
  expect(() => decode({ ...turn, status: "interrupted" })).toThrow()
  expect(() => decode({ ...turn, status: "interrupted", reason: "shutdown" })).toThrow()
})
