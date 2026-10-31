import { Effect } from "effect"
import { ai, DecisionClient, DecisionModel, type DecisionModelRoute, type DecisionRequestInput } from "../src/effect.js"
import type { Service } from "../src/decision-client.js"
import { baseten, openai, opencode, openrouter, typesafeAI } from "../src/providers.js"

type Requirements<T> = T extends Effect.Effect<infer _A, infer _E, infer R> ? R : never
type Success<T> = T extends Effect.Effect<infer A, infer _E, infer _R> ? A : never
type Equal<A, B> = [A, B] extends [B, A] ? true : false
type Assert<T extends true> = T

const request = ai.decision.request({
  model: typesafeAI.configure({ apiKey: "test" }).decision("jev-latest"),
  input: { ticket: "refund" },
  questions: [
    { name: "topic", type: "choice", instructions: "Which team?", choices: [{ value: "billing" }, { value: true }] },
    { name: "severity", type: "score", instructions: "How severe?", levels: [{ label: "Low" }, { label: "High" }] },
    { name: "refund", type: "predicate", instructions: "Refund?" },
  ],
})

const result = DecisionClient.generate(request)
type Answers = Success<typeof result>["answers"]
type Topic = Exclude<Answers[0], { readonly type: "error" }>
type Choice = Assert<Equal<Topic["choice"], "billing" | true>>
type Name = Assert<Equal<Answers[2]["name"], "refund">>
type ClientRequirements = Assert<Equal<Requirements<typeof result>, Service>>
void (true satisfies Choice)
void (true satisfies Name)
void (true satisfies ClientRequirements)

// A built request is a plain object: pass it back to `generate` as is, or edit it with a spread.
const generated = ai.decision.generate(request)
type GeneratedAnswers = Assert<Equal<Success<typeof generated>["answers"], Answers>>
void (true satisfies GeneratedAnswers)
ai.decision.generate({ ...request, input: [{ type: "text", text: "Charged twice" }] })

Effect.gen(function* () {
  const response = yield* ai.decision.generate({
    model: opencode.decision("jev-1.13"),
    input: [{ type: "text", text: "hello" }],
    questions: [{ name: "greeting", type: "predicate", instructions: "Greeting?" }],
  })
  const greeting = response.answers[0]
  if (greeting.type === "error") return
  greeting.probability satisfies number
  // @ts-expect-error Predicate answers do not contain a selected choice.
  greeting.choice
  // @ts-expect-error There is one answer per question.
  response.answers[1]
})
;({
  model: opencode.decision("jev-1.13"),
  // @ts-expect-error Input is a JSON object or a list of parts, not a plain string.
  input: "hello",
  questions: [{ name: "ok", type: "predicate", instructions: "OK?" }],
}) satisfies DecisionRequestInput

declare const route: DecisionModelRoute<{ readonly temperature?: number }>
const custom = DecisionModel.make({ id: "custom", provider: "custom", route })
ai.decision.generate({
  model: custom,
  input: { text: "hello" },
  questions: [{ name: "ok", type: "predicate", instructions: "OK?" }],
  providerOptions: { temperature: 0.5 },
})
;({
  model: custom,
  input: { text: "hello" },
  questions: [{ name: "ok", type: "predicate", instructions: "OK?" }],
  // @ts-expect-error Selected decision models retain their provider option types.
  providerOptions: { temperature: "high" },
}) satisfies DecisionRequestInput<typeof custom>

ai.decision.generate({
  model: openai.decision("gpt-6-luna"),
  input: { text: "hello" },
  questions: [{ name: "ok", type: "predicate", instructions: "OK?" }],
  providerOptions: { promptCacheKey: "support-v1", safetyIdentifier: "user-1" },
})
const openaiModel = openai.decision("gpt-6-luna")
;({
  model: openaiModel,
  input: { text: "hello" },
  questions: [{ name: "ok", type: "predicate", instructions: "OK?" }],
  // @ts-expect-error OpenAI safety identifiers are strings.
  providerOptions: { safetyIdentifier: 1 },
}) satisfies DecisionRequestInput<typeof openaiModel>

ai.decision.generate({
  model: openrouter.decision("typesafe/jev-1.13"),
  input: { text: "hello" },
  questions: [{ name: "ok", type: "predicate", instructions: "OK?" }],
  providerOptions: { provider: { zdr: true }, session_id: "session-1", user: "user-1" },
})
const openrouterModel = openrouter.decision("typesafe/jev-1.13")
;({
  model: openrouterModel,
  input: { text: "hello" },
  questions: [{ name: "ok", type: "predicate", instructions: "OK?" }],
  // @ts-expect-error OpenRouter session IDs are strings.
  providerOptions: { session_id: 1 },
}) satisfies DecisionRequestInput<typeof openrouterModel>

ai.decision.generate({
  model: baseten.decision("decision-models/baseten-elephant-9b-latest"),
  input: { text: "hello" },
  questions: [{ name: "ok", type: "predicate", instructions: "OK?" }],
  providerOptions: { max_len: 512 },
})
const basetenModel = baseten.decision("decision-models/baseten-elephant-9b-latest")
;({
  model: basetenModel,
  input: { text: "hello" },
  questions: [{ name: "ok", type: "predicate", instructions: "OK?" }],
  // @ts-expect-error Baseten max_len is a number.
  providerOptions: { max_len: "512" },
}) satisfies DecisionRequestInput<typeof basetenModel>
