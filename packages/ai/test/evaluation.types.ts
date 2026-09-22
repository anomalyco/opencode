import { Effect } from "effect"
import { Evaluation, EvaluationClient, EvaluationModel, type EvaluationRoute } from "../src/experimental.js"
import type { Service } from "../src/experimental/evaluation-client.js"
import { OpenCodeZen, TypeSafeAI } from "../src/providers.js"

type Requirements<T> = T extends Effect.Effect<infer _A, infer _E, infer R> ? R : never
type Success<T> = T extends Effect.Effect<infer A, infer _E, infer _R> ? A : never
type Equal<A, B> = [A, B] extends [B, A] ? true : false
type Assert<T extends true> = T

const model = TypeSafeAI.configure({ apiKey: "test" }).experimental.evaluation("jev-latest")
const request = Evaluation.request({
  model,
  state: { ticket: "refund" },
  questions: {
    topic: {
      type: "choice",
      instructions: "Which team?",
      criteria: { billing: null, support: { includes: ["help"] } },
    },
    severity: { type: "score", instructions: "How severe?", criteria: ["Low", "High"] },
    refund: { type: "boolean", instructions: "Refund?" },
  },
})

const result = EvaluationClient.evaluate(request)
type Result = Success<typeof result>
type Choice = Assert<Equal<Result["answers"]["topic"]["choice"], "billing" | "support">>
type ClientRequirements = Assert<Equal<Requirements<typeof result>, Service>>
void (true satisfies Choice)
void (true satisfies ClientRequirements)

Effect.gen(function* () {
  const response = yield* Evaluation.evaluate({
    model: OpenCodeZen.experimental.evaluation("jev-1.13"),
    state: ["hello"],
    questions: { greeting: { type: "boolean", instructions: "Greeting?" } },
  })
  response.answers.greeting.probability satisfies number
  // @ts-expect-error Boolean answers do not contain a selected choice.
  response.answers.greeting.choice
  // @ts-expect-error Unknown question IDs are not exposed.
  response.answers.missing
})

declare const route: EvaluationRoute<{ readonly temperature?: number }>
const custom = EvaluationModel.make({ id: "custom", provider: "custom", route })
Evaluation.evaluate({
  model: custom,
  state: "hello",
  questions: { ok: { type: "boolean", instructions: "OK?" } },
  options: { temperature: 0.5 },
})
// @ts-expect-error Selected evaluation models retain their request option types.
Evaluation.evaluate({
  model: custom,
  state: "hello",
  questions: { ok: { type: "boolean", instructions: "OK?" } },
  options: { temperature: "high" },
})
