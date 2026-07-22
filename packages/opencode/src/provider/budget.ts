import { Context, Effect, Layer, Schema } from "effect"

// --- Errors ---

export class BudgetExhaustedError extends Schema.TaggedErrorClass<BudgetExhaustedError>()(
  "BudgetExhaustedError",
  {
    message: Schema.String,
    userId: Schema.optional(Schema.String),
    required: Schema.optional(Schema.Number),
    balance: Schema.optional(Schema.Number),
  },
) {}

// --- Interface ---

export interface Interface {
  readonly resolveModel: (modelID: string) => Effect.Effect<{ costPerToken: number }>
  readonly check: (input: { userId: string; estimatedCost: number }) => Effect.Effect<void, BudgetExhaustedError>
  readonly deduct: (input: {
    userId: string
    amount: number
    description: string
    sessionId?: string
    model?: string
    tokensUsed?: number
    costUsd?: number
  }) => Effect.Effect<void>
  readonly credit: (input: {
    userId: string
    amount: number
    description: string
  }) => Effect.Effect<void>
}

// --- Service ---

export class Service extends Context.Service<Service, Interface>()("@opencode/Budget") {}

// --- No-op default layer ---

export const defaultLayer: Layer.Layer<Service> = Layer.succeed(
  Service,
  Service.of({
    resolveModel: () => Effect.succeed({ costPerToken: 0 }),
    check: () => Effect.void,
    deduct: () => Effect.void,
    credit: () => Effect.void,
  }),
)

export * as Budget from "./budget"
