import { Schema } from "effect"
import { zod } from "@/util/effect-zod"
import { withStatics } from "@/util/schema"

export const EffortTier = Schema.Literal("low", "medium", "high")
export type EffortTier = Schema.Schema.Type<typeof EffortTier>

export const TaskType = Schema.Literals([
  "coding",
  "reasoning",
  "exploration",
  "architecture",
  "debugging",
  "review",
  "general",
])
export type TaskType = Schema.Schema.Type<typeof TaskType>

export const BenchmarkScores = Schema.Struct({
  swe_bench_verified: Schema.Number,
  human_eval: Schema.Number,
  mbpp: Schema.Number,
  mmlu: Schema.Number,
  gpqa_diamond: Schema.Number,
})

export const SpeedMetrics = Schema.Struct({
  output_tokens_per_sec: Schema.Number,
  time_to_first_token_ms: Schema.Number,
})

export const PublishedCost = Schema.Struct({
  input_per_1m: Schema.Number,
  output_per_1m: Schema.Number,
})

export const ModelCapabilities = Schema.Struct({
  reasoning: Schema.Boolean,
  tool_call: Schema.Boolean,
  context_window: Schema.Number,
  vision: Schema.Boolean,
})

export const BenchmarkEntry = Schema.Struct({
  id: Schema.String,
  provider: Schema.String,
  name: Schema.String,
  family: Schema.String,
  release_date: Schema.String,
  benchmarks: BenchmarkScores,
  speed: SpeedMetrics,
  cost: PublishedCost,
  capabilities: ModelCapabilities,
  strengths: Schema.mutable(Schema.Array(Schema.String)),
  weaknesses: Schema.mutable(Schema.Array(Schema.String)),
  tier_hint: Schema.optional(EffortTier),
})

export const SubscriptionProvider = Schema.Struct({
  provider_id: Schema.String,
  cost_to_user: Schema.Literal("free", "subscription", "pay_per_token"),
  auth_type: Schema.String,
  eligible_model_patterns: Schema.mutable(Schema.Array(Schema.String)),
})

export const BenchmarkDatabase = Schema.Struct({
  version: Schema.String,
  updated: Schema.String,
  models: Schema.Record(Schema.String, BenchmarkEntry),
  subscription_providers: Schema.Record(Schema.String, SubscriptionProvider),
}).pipe(withStatics((s) => ({ zod: zod(s) })))

export const EffectiveCost = Schema.Struct({
  input_per_1m: Schema.Number,
  output_per_1m: Schema.Number,
  is_free: Schema.Boolean,
  source: Schema.Literal("subscription", "free_tier", "pay_per_token"),
})

export const SelectionRequest = Schema.Struct({
  tier: EffortTier,
  available_providers: Schema.mutable(Schema.Array(Schema.String)),
  available_models: Schema.mutable(
    Schema.Array(
      Schema.Struct({
        provider_id: Schema.String,
        model_id: Schema.String,
      }),
    ),
  ),
  no_paid_apis: Schema.Boolean,
  task_type: Schema.optional(TaskType),
})

export const SelectionResult = Schema.Struct({
  provider_id: Schema.String,
  model_id: Schema.String,
  score: Schema.Number,
  reason: Schema.String,
  tier: EffortTier,
  effective_cost: Schema.String,
})

export const TierWeights = Schema.Struct({
  coding_accuracy: Schema.Number,
  reasoning: Schema.Number,
  speed: Schema.Number,
  cost_efficiency: Schema.Number,
})

export const AllTierWeights = Schema.Struct({
  low: TierWeights,
  medium: TierWeights,
  high: TierWeights,
})
