import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { Decision, type DecisionModel, type DecisionOptions } from "../../src/effect.js"
import {
  Baseten,
  CloudflareAIGateway,
  CloudflareWorkersAI,
  DigitalOcean,
  OpenAI,
  OpenCode,
  OpenRouter,
  TypeSafeAI,
} from "../../src/providers.js"
import { recordedTests } from "../recorded-test.js"

const questions = [
  {
    name: "department",
    type: "choice",
    instructions: "Which team should handle this support request?",
    choices: [
      { value: "billing", description: "Payments, invoices, refunds, or failed charges" },
      { value: "technical", description: "Bugs, outages, or integrations" },
      { value: "sales", description: "Pricing, upgrades, or new accounts" },
    ],
  },
  {
    name: "urgency",
    type: "score",
    instructions: "How urgent is this support request?",
    levels: [
      { label: "Can wait for normal support" },
      { label: "Needs prompt attention" },
      { label: "Actively blocking revenue" },
    ],
  },
  { name: "refund", type: "predicate", instructions: "Is the customer asking for a refund?" },
] as const

const ticket = "I was charged twice for the same invoice. Please refund the duplicate payment today."

const typesafe = recordedTests({
  prefix: "typesafe-decision",
  provider: "typesafe-ai",
  protocol: "system-one",
  requires: ["TYPESAFE_API_KEY"],
  metadata: { model: "jev-latest" },
})

const opencode = recordedTests({
  prefix: "opencode-decision",
  provider: "opencode",
  protocol: "system-one",
  requires: ["OPENCODE_API_KEY"],
  metadata: { model: "jev-1.13-free" },
})

const openrouter = recordedTests({
  prefix: "openrouter-decision",
  provider: "openrouter",
  protocol: "system-one",
  requires: ["OPENROUTER_API_KEY"],
  metadata: { model: "typesafe/jev-1.13" },
})

const openai = recordedTests({
  prefix: "openai-decision",
  provider: "openai",
  protocol: "openai-decisions",
  requires: ["OPENAI_API_KEY"],
  metadata: { model: "gpt-6-luna" },
})

const cloudflareOptions = {
  redact: { url: (url: string) => url.replace(/\/client\/v4\/accounts\/[^/]+\//, "/client/v4/accounts/{account}/") },
}

const cloudflareWorkersAI = recordedTests({
  prefix: "cloudflare-workers-ai-decision",
  provider: "cloudflare-workers-ai",
  protocol: "system-one",
  requires: ["CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_API_KEY"],
  metadata: { model: "@cf/cloudflare/clef" },
  options: cloudflareOptions,
})

const cloudflareAIGateway = recordedTests({
  prefix: "cloudflare-ai-gateway-decision",
  provider: "cloudflare-ai-gateway",
  protocol: "system-one",
  requires: ["CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_API_TOKEN"],
  metadata: { model: "typesafe/jev" },
  options: cloudflareOptions,
})

const baseten = recordedTests({
  prefix: "baseten-decision",
  provider: "baseten",
  protocol: "system-one",
  requires: ["BASETEN_API_KEY"],
  metadata: { model: "decision-models/baseten-elephant-9b-latest" },
})

const digitalocean = recordedTests({
  prefix: "digitalocean-decision",
  provider: "digitalocean",
  protocol: "system-one",
  requires: ["DIGITALOCEAN_API_KEY"],
  metadata: { model: "typesafe-jev-1.13.0" },
})

describe("Decision recorded", () => {
  typesafe.effect("decides choice score and predicate questions", () =>
    assertDecision(TypeSafeAI.configure({ apiKey: process.env.TYPESAFE_API_KEY ?? "fixture" }).decision("jev-latest")),
  )

  opencode.effect("decides choice score and predicate questions", () =>
    assertDecision(OpenCode.configure({ apiKey: process.env.OPENCODE_API_KEY ?? "fixture" }).decision("jev-1.13-free")),
  )

  openrouter.effect("decides choice score and predicate questions", () =>
    assertDecision(
      OpenRouter.configure({ apiKey: process.env.OPENROUTER_API_KEY ?? "fixture" }).decision("typesafe/jev-1.13"),
    ),
  )

  openai.effect("decides choice score and predicate questions about JSON state", () =>
    assertDecision(OpenAI.configure({ apiKey: process.env.OPENAI_API_KEY ?? "fixture" }).decision("gpt-6-luna"), {
      ticket,
      plan: "pro",
    }).pipe(
      Effect.map((response) => {
        expect(response.providerMetadata?.openai).toMatchObject({ model: "gpt-6-luna", usage: { input_tokens: 430 } })
        expect(response.usage?.outputTokens).toBe(0)
      }),
    ),
  )

  cloudflareWorkersAI.effect("decides choice score and predicate questions", () =>
    assertDecision(
      CloudflareWorkersAI.configure({
        accountId: process.env.CLOUDFLARE_ACCOUNT_ID ?? "fixture-account",
        apiKey: process.env.CLOUDFLARE_API_KEY ?? "fixture",
      }).decision("@cf/cloudflare/clef"),
    ),
  )

  cloudflareAIGateway.effect("decides choice score and predicate questions", () =>
    assertDecision(
      CloudflareAIGateway.configure({
        accountId: process.env.CLOUDFLARE_ACCOUNT_ID ?? "fixture-account",
        gatewayApiKey: process.env.CLOUDFLARE_API_TOKEN ?? "fixture",
      }).decision("typesafe/jev"),
    ),
  )

  baseten.effect("decides choice score and predicate questions", () =>
    assertDecision(
      Baseten.configure({ apiKey: process.env.BASETEN_API_KEY ?? "fixture" }).decision(
        "decision-models/baseten-elephant-9b-latest",
      ),
    ),
  )

  digitalocean.effect("decides choice score and predicate questions", () =>
    assertDecision(
      DigitalOcean.configure({ apiKey: process.env.DIGITALOCEAN_API_KEY ?? "fixture" }).decision("typesafe-jev-1.13.0"),
    ),
  )
})

const assertDecision = <Options extends DecisionOptions>(
  model: DecisionModel<Options>,
  input: Parameters<typeof Decision.generate>[0]["input"] = [{ type: "text", text: ticket }],
) =>
  Effect.gen(function* () {
    const response = yield* Decision.generate({ model, input, questions })
    const [department, urgency, refund] = response.answers
    if (department.type === "error" || urgency.type === "error" || refund.type === "error")
      throw new Error("expected every question to be answered")
    expect(department.choice).toBe("billing")
    expect(department.probabilities.find((item) => item.value === "billing")?.probability).toBeGreaterThan(0.5)
    expect(department.confidence).toBeGreaterThan(0)
    expect(urgency.probabilities.map((item) => item.label)).toEqual(questions[1].levels.map((level) => level.label))
    expect(urgency.score).toBeGreaterThanOrEqual(0)
    expect(urgency.score).toBeLessThanOrEqual(2)
    expect(urgency.confidence).toBeGreaterThan(0)
    expect(refund.probability).toBeGreaterThan(0.5)
    expect(response.usage?.inputTokens).toBeGreaterThan(0)
    return response
  })
