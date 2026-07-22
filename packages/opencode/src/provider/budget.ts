import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Database } from "@opencode-ai/core/database/database"
import { TokenBalanceTable, TokenTransactionTable } from "@opencode-ai/core/account/sql"
import { eq, sql } from "drizzle-orm"
import { Context, Effect, Layer, Schema } from "effect"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ModelV2 } from "@opencode-ai/core/model"
import { Provider } from "@/provider/provider"

// --- Gating ---

const isEnabled = (): boolean => process.env["OPENCODE_TOKEN_MGMT"] !== undefined

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

// --- Helpers ---

/**
 * A free (Zen) model is one whose providerID starts with "opencode".
 * These models never consume budget and are always available.
 */
export function isFreeModel(providerID: string): boolean {
  return providerID.startsWith("opencode")
}

// --- Types ---

export interface ResolveModelInput {
  userId: string
  modelId: ModelV2.ID
  providerID: ProviderV2.ID
}

export interface ResolveModelResult {
  action: "free" | "paid" | "swapped"
  modelId: ModelV2.ID
  providerID: ProviderV2.ID
  originalModelId?: ModelV2.ID
  originalProviderID?: ProviderV2.ID
  costPerToken?: number
}

export interface Interface {
  readonly resolveModel: (
    input: ResolveModelInput,
  ) => Effect.Effect<ResolveModelResult, BudgetExhaustedError>
  readonly check: (input: {
    userId: string
    estimatedCost: number
  }) => Effect.Effect<void, BudgetExhaustedError>
  readonly deduct: (input: {
    userId: string
    amount: number
    model: ModelV2.ID
    providerID: ProviderV2.ID
    tokensUsed: number
    costUsd: number
    sessionId?: string
  }) => Effect.Effect<void>
  readonly credit: (input: {
    userId: string
    amount: number
    description: string
  }) => Effect.Effect<void>
}

// --- Service ---

export class Service extends Context.Service<Service, Interface>()("@opencode/Budget") {}

// --- Real Layer ---

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const { db } = yield* Database.Service
    const provider = yield* Provider.Service

    const resolveModel: Interface["resolveModel"] = (input) =>
      Effect.gen(function* () {
        if (!isEnabled() || isFreeModel(input.providerID)) {
          return { action: "free" as const, modelId: input.modelId, providerID: input.providerID }
        }

        const balanceRow = yield* db
          .select({ balance: TokenBalanceTable.balance })
          .from(TokenBalanceTable)
          .where(eq(TokenBalanceTable.userId, input.userId))
          .get()
          .pipe(Effect.catch(() => Effect.succeed(undefined)))

        const balance = balanceRow?.balance ?? 0

        if (balance > 0) {
          return { action: "paid" as const, modelId: input.modelId, providerID: input.providerID }
        }

        // Balance exhausted → find a Zen (opencode*) model as fallback
        const allProviders = yield* provider.list()
        for (const [provID, provInfo] of Object.entries(allProviders)) {
          if (provID.startsWith("opencode")) {
            const modelKeys = Object.keys(provInfo.models)
            if (modelKeys.length > 0) {
              return {
                action: "swapped" as const,
                modelId: ModelV2.ID.make(modelKeys[0]!),
                providerID: ProviderV2.ID.make(provID),
                originalModelId: input.modelId,
                originalProviderID: input.providerID,
              }
            }
          }
        }

        // No Zen alternative — fail
        return yield* new BudgetExhaustedError({
          message: "Free usage exceeded, subscribe to Go",
          userId: input.userId,
          required: 0,
          balance: 0,
        })
      })

    const check: Interface["check"] = (input) =>
      Effect.gen(function* () {
        if (!isEnabled()) return

        const balanceRow = yield* db
          .select({ balance: TokenBalanceTable.balance })
          .from(TokenBalanceTable)
          .where(eq(TokenBalanceTable.userId, input.userId))
          .get()
          .pipe(Effect.catch(() => Effect.succeed(undefined)))

        if (!balanceRow || balanceRow.balance <= 0) {
          return yield* new BudgetExhaustedError({
            message: "Insufficient balance",
            userId: input.userId,
            required: input.estimatedCost,
            balance: 0,
          })
        }
      })

    const deduct: Interface["deduct"] = (input) =>
      Effect.gen(function* () {
        if (!isEnabled() || isFreeModel(input.providerID)) return

        yield* db
          .transaction(
            (tx) =>
              Effect.gen(function* () {
                yield* tx
                  .update(TokenBalanceTable)
                  .set({
                    balance: sql`${TokenBalanceTable.balance} + ${input.amount}`,
                    lifetimeUsed: sql`${TokenBalanceTable.lifetimeUsed} + ${Math.abs(input.tokensUsed)}`,
                    updatedAt: Date.now(),
                  })
                  .where(eq(TokenBalanceTable.userId, input.userId))
                  .run()

                yield* tx
                  .insert(TokenTransactionTable)
                  .values({
                    userId: input.userId,
                    amount: input.amount,
                    model: input.model,
                    tokensUsed: input.tokensUsed,
                    costUsd: input.costUsd,
                    sessionId: input.sessionId ?? null,
                    createdAt: Date.now(),
                  })
                  .run()
              }),
            { behavior: "immediate" },
          )
          .pipe(Effect.catch(() => Effect.void))
      })

    const credit: Interface["credit"] = (input) =>
      Effect.gen(function* () {
        if (!isEnabled()) return
        // Credit is handled by Identity.Service.credit.
        // This placeholder keeps the interface complete.
      })

    return Service.of({ resolveModel, check, deduct, credit })
  }),
)

// --- Default (composed) layer ---

export const defaultLayer: Layer.Layer<Service> = Layer.suspend(() =>
  layer.pipe(
    Layer.provide(Database.defaultLayer),
    Layer.provide(Provider.defaultLayer),
  ),
)

export const node = LayerNode.make(layer, [Database.node, Provider.node])

export * as Budget from "./budget"
