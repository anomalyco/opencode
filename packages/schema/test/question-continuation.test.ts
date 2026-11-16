import { expect, test } from "bun:test"
import { Schema } from "effect"
import { QuestionContinuation } from "../src/question-continuation.js"
import { SessionEvent } from "../src/session-event.js"
import { SessionMessage } from "../src/session-message.js"

const prepared = {
  adapter: "question@1" as const,
  input: {
    questions: [{ question: "Continue?", header: "Continue", options: [{ label: "Yes", description: "Continue" }] }],
  },
}
const waiting = {
  status: "waiting" as const,
  input: prepared.input,
  metadata: { original: true },
  questionID: "frm_question",
  generation: 3,
}
const parked = {
  sessionID: "ses_question",
  assistantMessageID: "msg_question",
  generation: 3,
  finish: "tool-calls" as const,
  cost: 0,
  tokens: { input: 1, output: 2, reasoning: 0, cache: { read: 0, write: 0 } },
  questions: [{ callID: "call_question", questionID: "frm_question", prepared }] as const,
}

test("prepared question input round trips as JSON and omits undefined optionals", () => {
  const decoded = Schema.decodeUnknownSync(QuestionContinuation.Prepared)(prepared)
  expect(
    Schema.encodeSync(QuestionContinuation.Prepared)({
      ...decoded,
      input: { questions: [{ ...decoded.input.questions[0], multiple: undefined }] },
    }),
  ).toEqual(prepared)
  expect(Schema.decodeUnknownSync(QuestionContinuation.Prepared)(JSON.parse(JSON.stringify(decoded)))).toEqual(decoded)
  expect(QuestionContinuation.Prepared.fields.input).toBe(QuestionContinuation.Input)
})

test("continuations reject missing or unknown adapters and malformed question input", () => {
  const decode = Schema.decodeUnknownSync(QuestionContinuation.Prepared)
  for (const value of [
    { input: prepared.input },
    { ...prepared, adapter: "question@2" },
    { ...prepared, input: { questions: [] } },
    { ...prepared, input: { questions: [{ ...prepared.input.questions[0], options: [null] }] } },
  ])
    expect(() => decode(value)).toThrow()
})

test("parked payload preserves stream facts and canonical prepared continuations", () => {
  const decode = Schema.decodeUnknownSync(SessionEvent.Step.ParkedPayload)
  const decoded = decode(parked)
  expect(
    Schema.encodeSync(SessionEvent.Step.ParkedPayload)({
      ...decoded,
      rawFinish: undefined,
      native: undefined,
      snapshot: undefined,
      files: undefined,
    }),
  ).toEqual(parked)
  expect(Schema.decodeUnknownSync(SessionEvent.Step.Parked.data)(parked)).toEqual(decoded)
  expect(() => decode({ ...parked, questions: [] })).toThrow()
  expect(() =>
    decode({ ...parked, questions: [{ ...parked.questions[0], prepared: { ...prepared, adapter: "question@2" } }] }),
  ).toThrow()
})

test("parked events decode only durable version 1", () => {
  const event = {
    id: "evt_parked",
    created: 1,
    type: "session.step.parked" as const,
    durable: { aggregateID: parked.sessionID, seq: 4, version: 1 },
    data: parked,
  }
  const decoded = Schema.decodeUnknownSync(SessionEvent.Step.Parked)(event)
  expect(Schema.encodeSync(SessionEvent.Step.Parked)(decoded)).toEqual(event)
  for (const version of [undefined, 0, 2])
    expect(() =>
      Schema.decodeUnknownSync(SessionEvent.Step.Parked)({
        ...event,
        durable: { ...event.durable, version },
      }),
    ).toThrow()
})

test("waiting is a nonterminal tool state retaining original input and metadata", () => {
  const decoded = Schema.decodeUnknownSync(SessionMessage.ToolState)(waiting)
  expect(Schema.encodeSync(SessionMessage.ToolState)(decoded)).toEqual(waiting)
  expect(decoded).not.toHaveProperty("content")
  expect(decoded).not.toHaveProperty("error")
  expect(Schema.decodeUnknownSync(SessionMessage.ToolState)({ ...waiting, generation: 0 })).toMatchObject({ generation: 0 })
  expect(Schema.decodeUnknownSync(SessionEvent.Step.ParkedPayload)({ ...parked, generation: 0 })).toMatchObject({ generation: 0 })
  for (const generation of [-1, 1.5]) {
    expect(() => Schema.decodeUnknownSync(SessionMessage.ToolState)({ ...waiting, generation })).toThrow()
    expect(() => Schema.decodeUnknownSync(SessionEvent.Step.ParkedPayload)({ ...parked, generation })).toThrow()
  }
  expect(() => Schema.decodeUnknownSync(SessionMessage.ToolState)({ ...waiting, questionID: "question" })).toThrow()
  expect(() =>
    Schema.decodeUnknownSync(SessionMessage.ToolState)({ ...waiting, metadata: { invalid: () => {} } }),
  ).toThrow()
})
