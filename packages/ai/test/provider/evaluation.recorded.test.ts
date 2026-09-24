import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { Evaluation, EvaluationModel, type EvaluationOptions } from "../../src/experimental.js"
import { OpenCodeZen, OpenRouter, TypeSafeAI } from "../../src/providers.js"
import { recordedTests } from "../recorded-test.js"

const questions = {
  department: {
    type: "choice",
    instructions: "Which team should handle this support request?",
    criteria: {
      billing: "Payments, invoices, refunds, or failed charges",
      technical: "Bugs, outages, or integrations",
      sales: "Pricing, upgrades, or new accounts",
    },
  },
  urgency: {
    type: "score",
    instructions: "How urgent is this support request?",
    criteria: ["Can wait for normal support", "Needs prompt attention", "Actively blocking revenue"],
  },
  refund: { type: "boolean", instructions: "Is the customer asking for a refund?" },
} as const

const state = "I was charged twice for the same invoice. Please refund the duplicate payment today."

const typesafe = recordedTests({
  prefix: "typesafe-evaluation",
  provider: "typesafe-ai",
  protocol: "system-one",
  requires: ["TYPESAFE_API_KEY"],
  metadata: { model: "jev-latest" },
})

const zen = recordedTests({
  prefix: "opencode-zen-evaluation",
  provider: "opencode",
  protocol: "system-one",
  requires: ["OPENCODE_API_KEY"],
  metadata: { model: "jev-1.13-free" },
})

const openrouter = recordedTests({
  prefix: "openrouter-evaluation",
  provider: "openrouter",
  protocol: "system-one",
  requires: ["OPENROUTER_API_KEY"],
  metadata: { model: "typesafe/jev-1.13" },
})

describe("experimental Evaluation recorded", () => {
  typesafe.effect("evaluates choice score and boolean questions", () =>
    assertEvaluation(
      TypeSafeAI.configure({ apiKey: process.env.TYPESAFE_API_KEY ?? "fixture" }).experimental.evaluation("jev-latest"),
      "typesafe",
    ),
  )

  zen.effect("evaluates choice score and boolean questions", () =>
    assertEvaluation(
      OpenCodeZen.configure({ apiKey: process.env.OPENCODE_API_KEY ?? "fixture" }).experimental.evaluation(
        "jev-1.13-free",
      ),
      "opencode",
    ),
  )

  openrouter.effect("evaluates choice score and boolean questions", () =>
    assertEvaluation(
      OpenRouter.configure({ apiKey: process.env.OPENROUTER_API_KEY ?? "fixture" }).experimental.evaluation(
        "typesafe/jev-1.13",
      ),
      "openrouter",
    ),
  )
})

const assertEvaluation = <Options extends EvaluationOptions>(
  model: EvaluationModel<Options>,
  metadataKey: "typesafe" | "opencode" | "openrouter",
) =>
  Effect.gen(function* () {
    const response = yield* Evaluation.run({ model, state, questions })
    expect(response.model).toContain("jev-")
    expect(response.answers.department.type).toBe("choice")
    expect(response.answers.department.choice).toBe("billing")
    expect(response.answers.department.probabilities?.billing).toBeGreaterThan(0.5)
    expect(response.answers.urgency.type).toBe("score")
    expect(response.answers.urgency.score).toBeGreaterThanOrEqual(0)
    expect(response.answers.urgency.score).toBeLessThanOrEqual(2)
    expect(response.answers.refund.type).toBe("boolean")
    expect(response.answers.refund.probability).toBeGreaterThan(0.5)
    expect(response.usage?.inputTokens).toBeGreaterThan(0)
    expect(response.usage?.outputTokens).toBeGreaterThan(0)
    expect(response.providerMetadata?.[metadataKey]?.confidence).toBeDefined()
  })
