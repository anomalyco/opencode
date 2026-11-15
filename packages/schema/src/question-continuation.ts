export * as QuestionContinuation from "./question-continuation.js"

import { Schema } from "effect"
import { Question } from "./question.js"

export interface Input extends Schema.Schema.Type<typeof Input> {}
export const Input = Schema.Struct({
  questions: Schema.Array(Question.Prompt).check(Schema.isNonEmpty()).annotate({ description: "Questions to ask" }),
}).annotate({ identifier: "QuestionContinuation.Input" })

/** Serializable post-before-hook input for the Core-owned question executor. */
export interface Prepared extends Schema.Schema.Type<typeof Prepared> {}
export const Prepared = Schema.Struct({
  adapter: Schema.Literal("question@1"),
  input: Input,
}).annotate({ identifier: "QuestionContinuation.Prepared" })
