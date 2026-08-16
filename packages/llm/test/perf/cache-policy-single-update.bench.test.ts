import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { LLM, LLMRequest, Message } from "../../src"
import { Auth } from "../../src/route"
import * as AnthropicMessages from "../../src/protocols/anthropic-messages"
import { applyCachePolicy, cachePolicyPatch } from "../../src/cache-policy"
import { GenerationOptions, mergeGenerationOptions, mergeHttpOptions, mergeProviderOptions } from "../../src/schema"

const anthropicModel = AnthropicMessages.route
  .with({ endpoint: { baseURL: "https://api.anthropic.test/v1/" }, auth: Auth.header("x-api-key", "test") })
  .model({ id: "claude-sonnet-4-5" })

// Build a realistic long conversation: alternating user/assistant turns, each
// message carrying a few hundred chars of text — the shape that makes the
// per-turn full-history LLMRequest re-decode expensive.
function buildRequest(turns: number): LLMRequest {
  const messages = []
  for (let i = 0; i < turns; i++) {
    messages.push(Message.user(`user message ${i} ` + "x".repeat(400)))
    messages.push(Message.assistant(`assistant reply ${i} ` + "y".repeat(400)))
  }
  return LLM.request({
    model: anthropicModel,
    system: "You are concise. " + "s".repeat(2000),
    tools: [
      { name: "read", description: "read a file", inputSchema: { type: "object", properties: {} } },
      { name: "edit", description: "edit a file", inputSchema: { type: "object", properties: {} } },
    ],
    messages,
    cache: "auto",
  })
}

// Mirror client.ts resolveRequestOptionsPatch so the bench exercises the same
// two-step-vs-one-step shapes the real compile path takes.
const optionsPatch = (request: LLMRequest): Partial<LLMRequest.Input> => {
  const routeDefaults = request.model.route.defaults
  const modelDefaults = request.model.defaults
  const generation = mergeGenerationOptions(routeDefaults.generation, modelDefaults?.generation, request.generation)
  return {
    generation: generation ?? new GenerationOptions({}),
    providerOptions: mergeProviderOptions(routeDefaults.providerOptions, modelDefaults?.providerOptions, request.providerOptions),
    http: mergeHttpOptions(routeDefaults.http, modelDefaults?.http, request.http),
  }
}

// OLD shape: two sequential full-history reconstructions.
const twoStep = (request: LLMRequest): LLMRequest =>
  applyCachePolicy(LLMRequest.update(request, optionsPatch(request)))

// NEW shape: one reconstruction folding both disjoint patches.
const oneStep = (request: LLMRequest): LLMRequest =>
  LLMRequest.update(request, { ...optionsPatch(request), ...cachePolicyPatch(request) })

describe("cache-policy single-update", () => {
  test("one-step is byte-identical to two-step for Anthropic", () =>
    Effect.gen(function* () {
      const req = buildRequest(30)
      const a = twoStep(req)
      const b = oneStep(req)
      // Compare the fully-encoded provider bodies — the ground truth the
      // transport actually sends.
      const bodyA = yield* anthropicModel.route.body.from(a)
      const bodyB = yield* anthropicModel.route.body.from(b)
      expect(JSON.stringify(bodyB)).toBe(JSON.stringify(bodyA))
    }).pipe(Effect.runPromise))

  test("benchmark: two-step vs one-step", () => {
    const req = buildRequest(60) // 120 messages
    const N = 300
    // warmup
    for (let i = 0; i < 50; i++) {
      twoStep(req)
      oneStep(req)
    }
    let t = performance.now()
    for (let i = 0; i < N; i++) twoStep(req)
    const twoMs = performance.now() - t
    t = performance.now()
    for (let i = 0; i < N; i++) oneStep(req)
    const oneMs = performance.now() - t
    const perTurnSaved = (twoMs - oneMs) / N
    console.log(
      `two-step=${(twoMs / N).toFixed(3)}ms/turn  one-step=${(oneMs / N).toFixed(3)}ms/turn  saved=${perTurnSaved.toFixed(3)}ms/turn (${(twoMs / oneMs).toFixed(2)}x)`,
    )
    expect(oneMs).toBeLessThan(twoMs)
  })
})
