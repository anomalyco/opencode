import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { HttpClientRequest } from "effect/unstable/http"
import { Evaluation, EvaluationClient } from "../src/experimental.js"
import { OpenCodeZen, OpenRouter, TypeSafeAI, VercelAIGateway } from "../src/providers.js"
import { it } from "./lib/effect.js"
import { dynamicResponse } from "./lib/http.js"

describe("experimental Evaluation", () => {
  it.effect("evaluates typed questions through System One", () =>
    Effect.gen(function* () {
      const response = yield* Evaluation.run({
        model: TypeSafeAI.configure({
          apiKey: "test",
          baseURL: "https://typesafe.test/v1/",
          headers: { "x-default": "yes" },
          http: { body: { deployment: "test" }, query: { api: "v1" } },
        }).experimental.evaluation("jev-latest"),
        state: { ticket: "Please refund the duplicate charge." },
        questions: {
          department: {
            type: "choice",
            instructions: "Which team should handle this?",
            criteria: { billing: "Payments and refunds", technical: "Bugs and outages" },
          },
          urgency: {
            type: "score",
            instructions: "How urgent is this?",
            criteria: ["Can wait", "Needs attention", "Blocking"],
          },
          refund: { type: "boolean", instructions: "Is the customer asking for a refund?" },
        },
        options: { trace: { enabled: true } },
        http: { body: { request_metadata: "value" }, headers: { "x-request": "yes" }, query: { trace: "1" } },
      })

      expect(response.model).toBe("jev-1.13.0")
      expect(response.answers.department).toEqual({
        type: "choice",
        choice: "billing",
        probabilities: { billing: 0.9, technical: 0.1 },
      })
      expect(response.answers.urgency).toEqual({
        type: "score",
        score: 1.2,
        probabilities: { "0": 0, "1": 0.8, "2": 0.2 },
      })
      expect(response.answers.refund).toEqual({ type: "boolean", probability: 0.97 })
      expect(response.usage?.totalTokens).toBe(36)
      expect(response.providerMetadata).toEqual({
        typesafe: {
          confidence: { department: 0.8, urgency: 0.6 },
          legend: { urgency: { "0": "Can wait", "1": "Needs attention", "2": "Blocking" } },
        },
      })
    }).pipe(
      Effect.provide(
        EvaluationClient.layer.pipe(
          Layer.provide(
            dynamicResponse((input) =>
              Effect.gen(function* () {
                const request = yield* HttpClientRequest.toWeb(input.request).pipe(Effect.orDie)
                expect(request.url).toBe("https://typesafe.test/v1/systemone?api=v1&trace=1")
                expect(request.headers.get("authorization")).toBe("Bearer test")
                expect(request.headers.get("x-default")).toBe("yes")
                expect(request.headers.get("x-request")).toBe("yes")
                expect(JSON.parse(input.text)).toEqual({
                  deployment: "test",
                  request_metadata: "value",
                  trace: { enabled: true },
                  model: "jev-latest",
                  state: { ticket: "Please refund the duplicate charge." },
                  questions: {
                    department: {
                      type: "choice",
                      instructions: "Which team should handle this?",
                      criteria: { billing: "Payments and refunds", technical: "Bugs and outages" },
                    },
                    urgency: {
                      type: "score",
                      instructions: "How urgent is this?",
                      criteria: ["Can wait", "Needs attention", "Blocking"],
                    },
                    refund: { type: "noul", instructions: "Is the customer asking for a refund?" },
                  },
                })
                return input.respond(
                  JSON.stringify({
                    model: "jev-1.13.0",
                    answers: {
                      department: {
                        type: "choice",
                        choice: "billing",
                        probabilities: { billing: 0.9, technical: 0.1 },
                        confidence: 0.8,
                      },
                      urgency: {
                        type: "score",
                        score: 1.2,
                        probabilities: { "0": 0, "1": 0.8, "2": 0.2 },
                        legend: { "0": "Can wait", "1": "Needs attention", "2": "Blocking" },
                        confidence: 0.6,
                      },
                      refund: { type: "noul", noul: 0.97 },
                    },
                    usage: { input_tokens: 30, output_tokens: 6 },
                  }),
                  { headers: { "content-type": "application/json" } },
                )
              }),
            ),
          ),
        ),
      ),
    ),
  )

  it.effect("configures the OpenCode Zen System One endpoint", () =>
    Evaluation.run({
      model: OpenCodeZen.configure({ apiKey: "zen-key", baseURL: "https://zen.test/v1" }).experimental.evaluation(
        "jev-1.13",
      ),
      state: "hello",
      questions: { greeting: { type: "boolean", instructions: "Is this a greeting?" } },
    }).pipe(
      Effect.tap((response) =>
        Effect.sync(() => {
          expect(response.answers.greeting.probability).toBe(0.99)
          expect(response.usage?.providerMetadata).toEqual({
            opencode: { input_tokens: 10, output_tokens: 2 },
          })
        }),
      ),
      Effect.provide(
        EvaluationClient.layer.pipe(
          Layer.provide(
            dynamicResponse((input) => {
              expect(input.request.url).toBe("https://zen.test/v1/systemone")
              expect(input.request.headers.authorization).toBe("Bearer zen-key")
              return Effect.succeed(
                input.respond(
                  JSON.stringify({
                    model: "jev-1.13.0",
                    answers: { greeting: { type: "noul", noul: 0.99 } },
                    usage: { input_tokens: 10, output_tokens: 2 },
                  }),
                  { headers: { "content-type": "application/json" } },
                ),
              )
            }),
          ),
        ),
      ),
    ),
  )

  it.effect("evaluates through OpenRouter System One", () =>
    Evaluation.run({
      model: OpenRouter.configure({
        apiKey: "openrouter-key",
        baseURL: "https://openrouter.test/api/v1",
      }).experimental.evaluation("typesafe/jev-1.13"),
      state: "refund",
      questions: { refund: { type: "boolean", instructions: "Is a refund requested?" } },
      options: { user: "user-1", session_id: "session-1" },
    }).pipe(
      Effect.tap((response) =>
        Effect.sync(() => {
          expect(response.answers.refund.probability).toBe(0.98)
          expect(response.providerMetadata?.openrouter).toMatchObject({ responseId: "gen-1", provider: "TypeSafe" })
          expect(response.usage?.providerMetadata?.openrouter).toEqual({
            input_tokens: 10,
            output_tokens: 2,
            cost: 0.0001,
          })
        }),
      ),
      Effect.provide(
        EvaluationClient.layer.pipe(
          Layer.provide(
            dynamicResponse((input) => {
              expect(input.request.url).toBe("https://openrouter.test/api/v1/systemone")
              expect(input.request.headers.authorization).toBe("Bearer openrouter-key")
              expect(JSON.parse(input.text)).toMatchObject({
                model: "typesafe/jev-1.13",
                user: "user-1",
                session_id: "session-1",
                questions: { refund: { type: "noul" } },
              })
              return Effect.succeed(
                input.respond(
                  JSON.stringify({
                    id: "gen-1",
                    model: "typesafe/jev-1.13-20260917",
                    provider: "TypeSafe",
                    answers: { refund: { type: "noul", noul: 0.98 } },
                    usage: { input_tokens: 10, output_tokens: 2, cost: 0.0001 },
                  }),
                  { headers: { "content-type": "application/json" } },
                ),
              )
            }),
          ),
        ),
      ),
    ),
  )

  it.effect("evaluates through Vercel AI Gateway", () =>
    Evaluation.run({
      model: VercelAIGateway.configure({
        apiKey: "gateway-key",
        baseURL: "https://gateway.test/v1/",
      }).experimental.evaluation("typesafe-ai/jev"),
      state: "refund",
      questions: { refund: { type: "boolean", instructions: "Is a refund requested?" } },
      options: { gateway: { zeroDataRetention: true, only: ["typesafe-ai"] } },
    }).pipe(
      Effect.tap((response) =>
        Effect.sync(() => {
          expect(response.answers.refund.probability).toBe(0.98)
          expect(response.usage?.totalTokens).toBe(12)
          expect(response.providerMetadata?.gateway).toMatchObject({ generationId: "gen-1", cost: "0.0001" })
        }),
      ),
      Effect.provide(
        EvaluationClient.layer.pipe(
          Layer.provide(
            dynamicResponse((input) => {
              expect(input.request.url).toBe("https://gateway.test/v1/evaluate")
              expect(input.request.headers.authorization).toBe("Bearer gateway-key")
              expect(JSON.parse(input.text)).toEqual({
                model: "typesafe-ai/jev",
                state: "refund",
                questions: { refund: { type: "boolean", instructions: "Is a refund requested?" } },
                providerOptions: { gateway: { zeroDataRetention: true, only: ["typesafe-ai"] } },
              })
              return Effect.succeed(
                input.respond(
                  JSON.stringify({
                    model: "typesafe-ai/jev",
                    answers: { refund: { type: "boolean", probability: 0.98 } },
                    usage: { inputTokens: 10, outputTokens: 2 },
                    providerMetadata: { gateway: { generationId: "gen-1", cost: "0.0001" } },
                  }),
                  { headers: { "content-type": "application/json" } },
                ),
              )
            }),
          ),
        ),
      ),
    ),
  )

  it.effect("rejects answers that do not match their questions", () =>
    Evaluation.run({
      model: VercelAIGateway.configure({
        apiKey: "gateway-key",
        baseURL: "https://gateway.test/v1",
      }).experimental.evaluation("typesafe-ai/jev"),
      state: "refund",
      questions: { refund: { type: "boolean", instructions: "Is a refund requested?" } },
    }).pipe(
      Effect.flip,
      Effect.tap((error) => Effect.sync(() => expect(error.reason._tag).toBe("InvalidProviderOutput"))),
      Effect.provide(
        EvaluationClient.layer.pipe(
          Layer.provide(
            dynamicResponse((input) =>
              Effect.succeed(
                input.respond(
                  JSON.stringify({
                    answers: { refund: { type: "choice", choice: "yes", probabilities: { yes: 1 } } },
                  }),
                  { headers: { "content-type": "application/json" } },
                ),
              ),
            ),
          ),
        ),
      ),
    ),
  )

  it.effect("rejects malformed questions before network I/O", () =>
    Effect.gen(function* () {
      const error = yield* Evaluation.run({
        model: TypeSafeAI.experimental.evaluation("jev-latest"),
        state: "hello",
        questions: { score: { type: "score", instructions: "How much?", criteria: ["only"] } },
      }).pipe(Effect.flip)
      expect(error.reason._tag).toBe("InvalidRequest")
    }).pipe(
      Effect.provide(
        EvaluationClient.layer.pipe(
          Layer.provide(dynamicResponse(() => Effect.die("invalid evaluation reached the network"))),
        ),
      ),
    ),
  )
})
