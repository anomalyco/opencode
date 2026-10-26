import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { HttpClientRequest } from "effect/http"
import { Decision, DecisionClient, Media } from "../src/effect.js"
import {
  Baseten,
  CloudflareWorkersAI,
  OpenAI,
  OpenCode,
  OpenRouter,
  TypeSafeAI,
  VercelAIGateway,
} from "../src/providers.js"
import { it } from "./lib/effect.js"
import { dynamicResponse, json, type Handler } from "./lib/http.js"

const client = (handler: Handler) => DecisionClient.layer.pipe(Layer.provide(dynamicResponse(handler)))
const offline = client(() => Effect.die("an invalid decision request reached the network"))

const png = Media.bytes(new Uint8Array([1, 2, 3]), "image/png")

const questions = [
  {
    name: "department",
    type: "choice",
    instructions: "Which team should handle this?",
    choices: [{ value: "billing", description: "Payments and refunds" }, { value: "technical" }],
  },
  {
    name: "urgency",
    type: "score",
    instructions: "How urgent is this?",
    levels: [{ label: "Can wait" }, { label: "Needs attention", description: "Same day" }, { label: "Blocking" }],
  },
  { name: "refund", type: "predicate", instructions: "Is the customer asking for a refund?" },
] as const

const systemOneAnswers = {
  department: { type: "choice", choice: "billing", probabilities: { technical: 0.1, billing: 0.9 }, confidence: 0.8 },
  urgency: {
    type: "score",
    score: 1.2,
    probabilities: { "2": 0.2, "0": 0, "1": 0.8 },
    legend: { "0": "Can wait", "1": "Needs attention: Same day", "2": "Blocking" },
    confidence: 0.6,
  },
  refund: { type: "noul", noul: 0.97 },
}

const expectedAnswers = [
  {
    name: "department",
    type: "choice",
    choice: "billing",
    probabilities: [
      { value: "billing", probability: 0.9 },
      { value: "technical", probability: 0.1 },
    ],
    confidence: 0.8,
  },
  {
    name: "urgency",
    type: "score",
    score: 1.2,
    probabilities: [
      { value: 0, label: "Can wait", probability: 0 },
      { value: 1, label: "Needs attention", probability: 0.8 },
      { value: 2, label: "Blocking", probability: 0.2 },
    ],
    confidence: 0.6,
  },
  { name: "refund", type: "predicate", probability: 0.97 },
]

describe("Decision", () => {
  it.effect("decides through System One with TypeSafe image assets", () =>
    Effect.gen(function* () {
      const response = yield* Decision.generate({
        model: TypeSafeAI.configure({
          apiKey: "test",
          baseURL: "https://typesafe.test/v1/",
          headers: { "x-default": "yes" },
          http: { body: { deployment: "test" }, query: { api: "v1" } },
        }).decision("jev-latest"),
        input: [
          { type: "text", text: "Ticket:" },
          { type: "json", value: { ticket: "Please refund the duplicate charge." } },
          { type: "media", media: png },
        ],
        questions,
        providerOptions: { trace: { enabled: true } },
        http: { body: { request_metadata: "value" }, headers: { "x-request": "yes" }, query: { trace: "1" } },
      })

      expect(response.answers).toEqual(expectedAnswers)
      expect(response.usage?.totalTokens).toBe(36)
      expect(response.providerMetadata).toEqual({ typesafe: { model: "jev-1.14.0" } })
    }).pipe(
      Effect.provide(
        client((input) =>
          Effect.gen(function* () {
            const request = yield* HttpClientRequest.toWeb(input.request).pipe(Effect.orDie)
            expect(request.url).toBe("https://typesafe.test/v1/systemone?api=v1&trace=1")
            expect(request.headers.get("authorization")).toBe("Bearer test")
            expect(request.headers.get("x-default")).toBe("yes")
            expect(request.headers.get("x-request")).toBe("yes")
            expect(request.headers.get("typesafe-danger-zone-images")).toBe("true")
            expect(JSON.parse(input.text)).toEqual({
              deployment: "test",
              request_metadata: "value",
              trace: { enabled: true },
              model: "jev-latest",
              state: ["Ticket:", { ticket: "Please refund the duplicate charge." }, "<image-1>"],
              assets: { "<image-1>": { type: "image", format: "png", data_base64: "AQID" } },
              questions: {
                department: {
                  type: "choice",
                  instructions: "Which team should handle this?",
                  criteria: { billing: "Payments and refunds", technical: null },
                },
                urgency: {
                  type: "score",
                  instructions: "How urgent is this?",
                  criteria: ["Can wait", "Needs attention: Same day", "Blocking"],
                },
                refund: { type: "noul", instructions: "Is the customer asking for a refund?" },
              },
            })
            return json(input, {
              model: "jev-1.14.0",
              answers: systemOneAnswers,
              usage: { input_tokens: 30, output_tokens: 6 },
            })
          }),
        ),
      ),
    ),
  )

  it.effect("sends a lone input object as the System One state and maps boolean choices back", () =>
    Decision.generate({
      model: OpenCode.configure({ apiKey: "opencode-key", baseURL: "https://opencode.test/v1" }).decision("jev-1.13"),
      input: { ticket: "hello" },
      questions: [
        {
          name: "greeting",
          type: "choice",
          instructions: "Is this a greeting?",
          choices: [{ value: true }, { value: false }],
        },
      ],
    }).pipe(
      Effect.tap((response) =>
        Effect.sync(() => {
          const answer = response.answers[0]
          if (answer.type !== "choice") throw new Error("expected a choice answer")
          expect(answer.choice).toBe(true)
          expect(answer.probabilities).toEqual([
            { value: true, probability: 0.99 },
            { value: false, probability: 0.01 },
          ])
          expect(response.usage?.providerMetadata).toEqual({ opencode: { input_tokens: 10, output_tokens: 2 } })
        }),
      ),
      Effect.provide(
        client((input) => {
          expect(input.request.url).toBe("https://opencode.test/v1/systemone")
          expect(input.request.headers.authorization).toBe("Bearer opencode-key")
          expect(input.request.headers["typesafe-danger-zone-images"]).toBe("true")
          expect(JSON.parse(input.text)).toEqual({
            model: "jev-1.13",
            state: { ticket: "hello" },
            questions: {
              greeting: { type: "choice", instructions: "Is this a greeting?", criteria: { true: null, false: null } },
            },
          })
          return Effect.succeed(
            json(input, {
              model: "jev-1.13.0",
              answers: {
                greeting: { type: "choice", choice: "true", probabilities: { false: 0.01, true: 0.99 }, confidence: 1 },
              },
              usage: { input_tokens: 10, output_tokens: 2 },
            }),
          )
        }),
      ),
    ),
  )

  it.effect("rejects a choice with both a boolean and a string of the same text for System One", () =>
    Effect.gen(function* () {
      const error = yield* Decision.generate({
        model: TypeSafeAI.decision("jev-latest"),
        input: { ticket: "hello" },
        questions: [{ name: "ok", type: "choice", instructions: "OK?", choices: [{ value: true }, { value: "true" }] }],
      }).pipe(Effect.flip)
      expect(error.reason._tag).toBe("InvalidRequest")
      expect(error.message).toContain("ok")
    }).pipe(Effect.provide(offline)),
  )

  it.effect("places media in the OpenRouter state and downloads URL media first", () =>
    Decision.generate({
      model: OpenRouter.configure({ apiKey: "openrouter-key", baseURL: "https://openrouter.test/api/v1" }).decision(
        "cloudflare/clef-omni",
      ),
      input: [
        { type: "text", text: "Before:" },
        { type: "media", media: Media.url("https://assets.test/before.png", { mediaType: "image/png" }) },
        { type: "media", media: Media.base64("AAAA", "audio/wav") },
      ],
      questions: [{ name: "red", type: "predicate", instructions: "Is the image mostly red?" }],
      providerOptions: { user: "user-1", session_id: "session-1" },
    }).pipe(
      Effect.tap((response) =>
        Effect.sync(() => {
          expect(response.answers).toEqual([{ name: "red", type: "predicate", probability: 0.98 }])
          expect(response.providerMetadata?.openrouter).toEqual({
            model: "cloudflare/clef-omni-20261001",
            responseId: "gen-1",
            provider: "Cloudflare",
          })
        }),
      ),
      Effect.provide(
        client((input) => {
          if (input.request.method === "GET") {
            expect(input.request.url).toBe("https://assets.test/before.png")
            return Effect.succeed(
              input.respond(new Uint8Array([1, 2, 3]), { headers: { "content-type": "image/png" } }),
            )
          }
          expect(input.request.url).toBe("https://openrouter.test/api/v1/systemone")
          expect(JSON.parse(input.text)).toEqual({
            model: "cloudflare/clef-omni",
            user: "user-1",
            session_id: "session-1",
            state: [
              "Before:",
              { type: "image_url", image_url: { url: "data:image/png;base64,AQID" } },
              { type: "input_audio", input_audio: { data: "AAAA", format: "wav" } },
            ],
            questions: { red: { type: "noul", instructions: "Is the image mostly red?" } },
          })
          return Effect.succeed(
            json(input, {
              id: "gen-1",
              model: "cloudflare/clef-omni-20261001",
              provider: "Cloudflare",
              answers: { red: { type: "noul", noul: 0.98 } },
            }),
          )
        }),
      ),
    ),
  )

  it.effect("puts media in a user message inside the Baseten state", () =>
    Decision.generate({
      model: Baseten.configure({ apiKey: "baseten-key" }).decision("decision-models/baseten-mammoth-27b-latest"),
      input: [
        { type: "text", text: "Photo:" },
        { type: "media", media: png },
        { type: "json", value: { source: "upload" } },
      ],
      questions: [{ name: "red", type: "predicate", instructions: "Is the photo mostly red?" }],
    }).pipe(
      Effect.tap((response) =>
        Effect.sync(() => expect(response.answers).toEqual([{ name: "red", type: "predicate", probability: 0.99 }])),
      ),
      Effect.provide(
        client((input) => {
          expect(input.request.url).toBe("https://inference.baseten.co/v1/systemone")
          expect(JSON.parse(input.text)).toEqual({
            model: "decision-models/baseten-mammoth-27b-latest",
            state: {
              messages: [
                {
                  role: "user",
                  content: [
                    { type: "text", text: "Photo:" },
                    { type: "image_url", image_url: { url: "data:image/png;base64,AQID" } },
                    { type: "text", text: '{"source":"upload"}' },
                  ],
                },
              ],
            },
            questions: { red: { type: "noul", instructions: "Is the photo mostly red?" } },
          })
          return Effect.succeed(json(input, { model: "mammoth", answers: { red: { type: "noul", noul: 0.99 } } }))
        }),
      ),
    ),
  )

  it.effect("decides through OpenAI Decisions", () =>
    Decision.generate({
      model: OpenAI.configure({
        apiKey: "openai-key",
        baseURL: "https://openai.test/v1",
        queryParams: { api: "v1" },
      }).decision("gpt-6-luna"),
      input: [
        { type: "text", text: "Ticket:" },
        { type: "json", value: { ticket: "Please refund the duplicate charge." } },
        { type: "json", value: 42 },
        { type: "media", media: png },
        { type: "media", media: Media.url("https://assets.test/receipt.jpg", { mediaType: "image/jpeg" }) },
      ],
      questions,
      providerOptions: { safetyIdentifier: "user-1", promptCacheKey: "support-v1" },
    }).pipe(
      Effect.tap((response) =>
        Effect.sync(() => {
          expect(response.answers).toEqual(expectedAnswers)
          expect(response.usage?.inputTokens).toBe(40)
          expect(response.providerMetadata).toEqual({ openai: { model: "gpt-6-luna" } })
        }),
      ),
      Effect.provide(
        client((input) => {
          expect(input.request.url).toBe("https://openai.test/v1/decisions?api=v1")
          expect(input.request.headers.authorization).toBe("Bearer openai-key")
          expect(JSON.parse(input.text)).toEqual({
            safety_identifier: "user-1",
            prompt_cache_key: "support-v1",
            model: "gpt-6-luna",
            input: [
              {
                role: "user",
                content: [
                  { type: "input_text", text: "Ticket:" },
                  { type: "input_json", data: { ticket: "Please refund the duplicate charge." } },
                  { type: "input_text", text: "42" },
                  { type: "input_image", image_url: "data:image/png;base64,AQID" },
                  { type: "input_image", image_url: "https://assets.test/receipt.jpg" },
                ],
              },
            ],
            questions: [
              {
                name: "department",
                type: "choice",
                instructions: "Which team should handle this?",
                choices: [{ value: "billing", description: "Payments and refunds" }, { value: "technical" }],
              },
              {
                name: "urgency",
                type: "score",
                instructions: "How urgent is this?",
                levels: [
                  { label: "Can wait" },
                  { label: "Needs attention", description: "Same day" },
                  { label: "Blocking" },
                ],
              },
              { name: "refund", type: "predicate", instructions: "Is the customer asking for a refund?" },
            ],
          })
          // Answers come back out of order; the protocol restores question order by name.
          return Effect.succeed(
            json(input, {
              model: "gpt-6-luna",
              answers: [
                { type: "predicate", name: "refund", probability: 0.97 },
                {
                  type: "choice",
                  name: "department",
                  choice: "billing",
                  probabilities: [
                    { value: "billing", probability: 0.9 },
                    { value: "technical", probability: 0.1 },
                  ],
                  confidence: 0.8,
                },
                {
                  type: "score",
                  name: "urgency",
                  score: 1.2,
                  probabilities: [
                    { value: 0, label: "Can wait", probability: 0 },
                    { value: 1, label: "Needs attention", probability: 0.8 },
                    { value: 2, label: "Blocking", probability: 0.2 },
                  ],
                  confidence: 0.6,
                },
              ],
              usage: { input_tokens: 40, output_tokens: 0, total_tokens: 40 },
            }),
          )
        }),
      ),
    ),
  )

  it.effect("returns OpenAI refusals as per-question errors", () =>
    Decision.generate({
      model: OpenAI.configure({ apiKey: "openai-key" }).decision("gpt-6-luna"),
      input: [{ type: "text", text: "hello" }],
      questions: [
        { name: "greeting", type: "predicate", instructions: "Is this a greeting?" },
        { name: "unsafe", type: "predicate", instructions: "Something the model declines" },
      ],
    }).pipe(
      Effect.tap((response) =>
        Effect.sync(() =>
          expect(response.answers).toEqual([
            { name: "greeting", type: "predicate", probability: 0.99 },
            { name: "unsafe", type: "error", reason: "refusal" },
          ]),
        ),
      ),
      Effect.provide(
        client((input) =>
          Effect.succeed(
            json(input, {
              model: "gpt-6-luna",
              answers: [
                { type: "predicate", name: "greeting", probability: 0.99 },
                { type: "refusal", name: "unsafe" },
              ],
            }),
          ),
        ),
      ),
    ),
  )

  it.effect("rejects audio for OpenAI Decisions before network I/O", () =>
    Effect.gen(function* () {
      const error = yield* Decision.generate({
        model: OpenAI.configure({ apiKey: "openai-key" }).decision("gpt-6-luna"),
        input: [{ type: "media", media: Media.base64("AAAA", "audio/wav") }],
        questions: [{ name: "speech", type: "predicate", instructions: "Is someone speaking?" }],
      }).pipe(Effect.flip)
      expect(error.reason._tag).toBe("UnsupportedOperation")
      expect(error.message).toContain("audio")
    }).pipe(Effect.provide(offline)),
  )

  it.effect("decides through Vercel AI Gateway's OpenAI Decisions endpoint", () =>
    Decision.generate({
      model: VercelAIGateway.configure({ apiKey: "gateway-key", baseURL: "https://gateway.test/v1/" }).decision(
        "typesafe-ai/jev",
      ),
      input: [{ type: "text", text: "refund" }],
      questions: [{ name: "refund", type: "predicate", instructions: "Is a refund requested?" }],
    }).pipe(
      Effect.tap((response) =>
        Effect.sync(() => {
          expect(response.answers).toEqual([{ name: "refund", type: "predicate", probability: 0.98 }])
          expect(response.providerMetadata).toEqual({ "vercel-ai-gateway": { model: "typesafe-ai/jev" } })
          expect(response.usage?.providerMetadata).toHaveProperty("vercel-ai-gateway")
        }),
      ),
      Effect.provide(
        client((input) => {
          expect(input.request.url).toBe("https://gateway.test/v1/decisions")
          expect(input.request.headers.authorization).toBe("Bearer gateway-key")
          expect(JSON.parse(input.text)).toEqual({
            model: "typesafe-ai/jev",
            input: [{ role: "user", content: [{ type: "input_text", text: "refund" }] }],
            questions: [{ name: "refund", type: "predicate", instructions: "Is a refund requested?" }],
          })
          return Effect.succeed(
            json(input, {
              model: "typesafe-ai/jev",
              answers: [{ type: "predicate", name: "refund", probability: 0.98 }],
              usage: { input_tokens: 10, output_tokens: 0 },
            }),
          )
        }),
      ),
    ),
  )

  it.effect("puts media in Clef's top-level lists on Cloudflare Run", () =>
    Decision.generate({
      model: CloudflareWorkersAI.configure({ accountId: "test-account", apiKey: "cloudflare-key" }).decision(
        "@cf/cloudflare/clef-omni",
      ),
      input: [
        { type: "text", text: "Compare:" },
        { type: "media", media: png },
        { type: "media", media: Media.base64("AAAA", "audio/wav") },
      ],
      questions: [{ name: "red", type: "predicate", instructions: "Is the image mostly red?" }],
    }).pipe(
      Effect.tap((response) =>
        Effect.sync(() => {
          expect(response.answers).toEqual([{ name: "red", type: "predicate", probability: 0.9 }])
          expect(response.providerMetadata).toEqual({ "cloudflare-workers-ai": { model: "clef-omni" } })
        }),
      ),
      Effect.provide(
        client((input) => {
          expect(input.request.url).toBe("https://api.cloudflare.com/client/v4/accounts/test-account/ai/run")
          expect(JSON.parse(input.text)).toEqual({
            model: "@cf/cloudflare/clef-omni",
            input: {
              state: "Compare:",
              images: ["data:image/png;base64,AQID"],
              audio: ["data:audio/wav;base64,AAAA"],
              questions: { red: { type: "noul", instructions: "Is the image mostly red?" } },
            },
          })
          return Effect.succeed(
            json(input, { result: { model: "clef-omni", answers: { red: { type: "noul", noul: 0.9 } } } }),
          )
        }),
      ),
    ),
  )

  it.effect("surfaces Cloudflare Run errors", () =>
    Decision.generate({
      model: CloudflareWorkersAI.configure({ accountId: "test-account", apiKey: "cloudflare-key" }).decision(
        "@cf/cloudflare/clef",
      ),
      input: [{ type: "text", text: "refund" }],
      questions: [{ name: "refund", type: "predicate", instructions: "Is a refund requested?" }],
    }).pipe(
      Effect.flip,
      Effect.tap((error) =>
        Effect.sync(() => {
          expect(error.reason._tag).toBe("InvalidRequest")
          expect(error.message).toContain("At least one question is required")
        }),
      ),
      Effect.provide(
        client((input) =>
          Effect.succeed(
            json(
              input,
              {
                errors: [
                  {
                    message:
                      "Model execution failed (User Input Error): Validation error at questions: At least one question is required",
                    code: 7003,
                  },
                ],
                success: false,
                result: {},
                messages: [],
              },
              { status: 400 },
            ),
          ),
        ),
      ),
    ),
  )

  it.effect("fails the call when an answer picks an option that wasn't offered", () =>
    Decision.generate({
      model: OpenAI.configure({ apiKey: "openai-key" }).decision("gpt-6-luna"),
      input: [{ type: "text", text: "refund" }],
      questions: [{ name: "tone", type: "choice", instructions: "Tone?", choices: [{ value: "calm" }] }],
    }).pipe(
      Effect.flip,
      Effect.tap((error) => Effect.sync(() => expect(error.reason._tag).toBe("InvalidProviderOutput"))),
      Effect.provide(
        client((input) =>
          Effect.succeed(
            json(input, {
              model: "gpt-6-luna",
              answers: [
                {
                  type: "choice",
                  name: "tone",
                  choice: "angry",
                  probabilities: [{ value: "angry", probability: 1 }],
                  confidence: 1,
                },
              ],
            }),
          ),
        ),
      ),
    ),
  )

  it.effect("fails the call when System One leaves a question unanswered", () =>
    Decision.generate({
      model: TypeSafeAI.configure({ apiKey: "test" }).decision("jev-latest"),
      input: [{ type: "text", text: "refund" }],
      questions: [
        { name: "refund", type: "predicate", instructions: "Refund?" },
        { name: "angry", type: "predicate", instructions: "Angry?" },
      ],
    }).pipe(
      Effect.flip,
      Effect.tap((error) => Effect.sync(() => expect(error.reason._tag).toBe("InvalidProviderOutput"))),
      Effect.provide(
        client((input) =>
          Effect.succeed(json(input, { model: "jev-1.14.0", answers: { refund: { type: "noul", noul: 0.9 } } })),
        ),
      ),
    ),
  )

  it.effect("rejects duplicate question names before network I/O", () =>
    Effect.gen(function* () {
      const error = yield* Decision.generate({
        model: TypeSafeAI.decision("jev-latest"),
        input: [{ type: "text", text: "hello" }],
        questions: [
          { name: "same", type: "predicate", instructions: "One?" },
          { name: "same", type: "predicate", instructions: "Two?" },
        ],
      }).pipe(Effect.flip)
      expect(error.reason._tag).toBe("InvalidRequest")
    }).pipe(Effect.provide(offline)),
  )
})
