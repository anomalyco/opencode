import { expect, test } from "bun:test"
import { Schema } from "effect"
import { Question } from "../src/question"
import { QuestionV1 } from "../src/question-v1"

test("question options accept optional recommendations without changing answers", () => {
  const input = {
    label: "Start new session",
    description: "Implement with a clean context",
    recommended: true,
  }

  expect(Schema.decodeUnknownSync(Question.Option)(input)).toEqual(input)
  expect(Schema.decodeUnknownSync(QuestionV1.Option)(input)).toEqual(input)
  expect(Schema.decodeUnknownSync(Question.Option)({ label: "Continue", description: "Continue here" })).toEqual({
    label: "Continue",
    description: "Continue here",
  })
})
