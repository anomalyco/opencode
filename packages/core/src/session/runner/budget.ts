export * as SessionBudget from "./budget"

import { SessionSchema } from "../schema"
import { ModelV2 } from "../../model"

export interface TokenUsageStats {
  readonly input: number
  readonly output: number
  readonly reasoning?: number
  readonly cache?: { readonly read: number; readonly write: number }
}

export interface ModelPricing {
  readonly inputPerMillion: number
  readonly outputPerMillion: number
  readonly cacheReadPerMillion?: number
  readonly cacheWritePerMillion?: number
}

const MODEL_PRICING: Record<string, ModelPricing> = {
  // Anthropic
  "claude-3-5-sonnet": { inputPerMillion: 3.0, outputPerMillion: 15.0, cacheReadPerMillion: 0.3, cacheWritePerMillion: 3.75 },
  "claude-3-5-haiku": { inputPerMillion: 0.8, outputPerMillion: 4.0, cacheReadPerMillion: 0.08, cacheWritePerMillion: 1.0 },
  "claude-3-opus": { inputPerMillion: 15.0, outputPerMillion: 75.0 },
  // OpenAI
  "gpt-4o": { inputPerMillion: 2.5, outputPerMillion: 10.0, cacheReadPerMillion: 1.25 },
  "gpt-4o-mini": { inputPerMillion: 0.15, outputPerMillion: 0.6, cacheReadPerMillion: 0.075 },
  "o1": { inputPerMillion: 15.0, outputPerMillion: 60.0 },
  "o3-mini": { inputPerMillion: 1.1, outputPerMillion: 4.4 },
  // Default fallback
  default: { inputPerMillion: 2.0, outputPerMillion: 8.0 },
}

export const getModelPricing = (modelId: string): ModelPricing => {
  const norm = modelId.toLowerCase()
  const sortedKeys = Object.keys(MODEL_PRICING).sort((a, b) => b.length - a.length)
  for (const key of sortedKeys) {
    if (key !== "default" && norm.includes(key)) {
      return MODEL_PRICING[key]!
    }
  }
  return MODEL_PRICING.default!
}

export const calculateTokenCost = (modelId: string, tokens: TokenUsageStats): number => {
  const pricing = getModelPricing(modelId)
  const inputCost = (tokens.input / 1_000_000) * pricing.inputPerMillion
  const outputCost = ((tokens.output + (tokens.reasoning ?? 0)) / 1_000_000) * pricing.outputPerMillion
  const cacheReadCost = tokens.cache?.read ? (tokens.cache.read / 1_000_000) * (pricing.cacheReadPerMillion ?? pricing.inputPerMillion * 0.1) : 0
  const cacheWriteCost = tokens.cache?.write ? (tokens.cache.write / 1_000_000) * (pricing.cacheWritePerMillion ?? pricing.inputPerMillion * 1.25) : 0

  const total = inputCost + outputCost + cacheReadCost + cacheWriteCost
  return Math.round(total * 1_000_000) / 1_000_000
}

export interface SessionBudgetInfo {
  spentUsd: number
  budgetLimitUsd: number
  remainingUsd: number
  percentageSpent: number
  shouldDowngrade: boolean
  downgradedModel?: string
}

const sessionBudgetStore = new Map<string, { spentUsd: number; limitUsd: number; downgraded: boolean }>()

export const DEFAULT_SESSION_BUDGET_USD = 2.0 // $2.00 default session budget

export const setSessionBudget = (sessionID: SessionSchema.ID, limitUsd: number): void => {
  const existing = sessionBudgetStore.get(sessionID)
  sessionBudgetStore.set(sessionID, {
    spentUsd: existing?.spentUsd ?? 0,
    limitUsd,
    downgraded: existing?.downgraded ?? false,
  })
}

export const recordStepCost = (sessionID: SessionSchema.ID, costUsd: number): SessionBudgetInfo => {
  const existing = sessionBudgetStore.get(sessionID) ?? { spentUsd: 0, limitUsd: DEFAULT_SESSION_BUDGET_USD, downgraded: false }
  existing.spentUsd += costUsd
  sessionBudgetStore.set(sessionID, existing)
  return getBudgetStatus(sessionID)
}

export const getBudgetStatus = (sessionID: SessionSchema.ID): SessionBudgetInfo => {
  const current = sessionBudgetStore.get(sessionID) ?? { spentUsd: 0, limitUsd: DEFAULT_SESSION_BUDGET_USD, downgraded: false }
  const remainingUsd = Math.max(0, current.limitUsd - current.spentUsd)
  const percentageSpent = Math.min(100, Math.round((current.spentUsd / current.limitUsd) * 100))
  // Trigger auto-downgrade when >= 75% spent or remaining < $0.30
  const shouldDowngrade = percentageSpent >= 75 || remainingUsd < 0.30

  return {
    spentUsd: Math.round(current.spentUsd * 10_000) / 10_000,
    budgetLimitUsd: current.limitUsd,
    remainingUsd: Math.round(remainingUsd * 10_000) / 10_000,
    percentageSpent,
    shouldDowngrade,
    downgradedModel: shouldDowngrade ? "claude-3-5-haiku" : undefined,
  }
}

export const getDowngradedModelFallback = (currentModelId: string): string => {
  const lower = currentModelId.toLowerCase()
  if (lower.includes("sonnet") || lower.includes("opus")) return "claude-3-5-haiku"
  if (lower.includes("gpt-4o") || lower.includes("o1") || lower.includes("o3")) return "gpt-4o-mini"
  return "gpt-4o-mini"
}
