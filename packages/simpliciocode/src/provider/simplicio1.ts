// Simplicio1 — the SimplicioCode local AI family with auto-selection.
// REQUIREMENTS: #6 (R4), #10 (R8).
//
// Tiers (lightest → heaviest):
//   qwen2.5-coder:1.5b  ≥ 2 GB RAM
//   qwen2.5-coder:3b    ≥ 4 GB RAM
//   qwen2.5-coder:7b    ≥ 8 GB RAM
//   qwen2.5-coder:14b   ≥ 16 GB RAM
//   deepseek-v4-pro     HF Inference, budget $5 USD (preferred when balance ≥ $0.10)
//
// Selection rule:
//   1. If HF_TOKEN is set and remaining budget ≥ $0.10 → DeepSeek V4 Pro.
//   2. Otherwise, pick the largest Qwen tier whose minRamGb ≤ totalMem.
//   3. Always returns a tier; never throws.

import os from "node:os"

export interface SimplicioTier {
  id: "1.5b" | "3b" | "7b" | "14b" | "deepseek-v4-pro"
  label: string
  provider: "ollama" | "huggingface"
  model: string
  baseUrl: string
  minRamGb?: number
  kind: "local" | "remote"
  budgetUsd?: number
  envToken?: string
}

const TIERS: SimplicioTier[] = [
  {
    id: "deepseek-v4-pro",
    label: "Simplicio1 — DeepSeek V4 Pro (HF, budget $5)",
    provider: "huggingface",
    model: "deepseek-ai/DeepSeek-V4-Pro",
    baseUrl: "https://api-inference.huggingface.co/v1",
    envToken: "HF_TOKEN",
    budgetUsd: 5.0,
    kind: "remote",
  },
  {
    id: "14b",
    label: "Simplicio1 — Qwen 2.5 Coder 14B (Local • Free)",
    provider: "ollama",
    model: "qwen2.5-coder:14b",
    baseUrl: "http://localhost:11434/v1",
    minRamGb: 16,
    kind: "local",
  },
  {
    id: "7b",
    label: "Simplicio1 — Qwen 2.5 Coder 7B (Local • Free)",
    provider: "ollama",
    model: "qwen2.5-coder:7b",
    baseUrl: "http://localhost:11434/v1",
    minRamGb: 8,
    kind: "local",
  },
  {
    id: "3b",
    label: "Simplicio1 — Qwen 2.5 Coder 3B (Local • Free)",
    provider: "ollama",
    model: "qwen2.5-coder:3b",
    baseUrl: "http://localhost:11434/v1",
    minRamGb: 4,
    kind: "local",
  },
  {
    id: "1.5b",
    label: "Simplicio1 — Qwen 2.5 Coder 1.5B (Local • Free)",
    provider: "ollama",
    model: "qwen2.5-coder:1.5b",
    baseUrl: "http://localhost:11434/v1",
    minRamGb: 2,
    kind: "local",
  },
]

export function totalRamGb(): number {
  return os.totalmem() / 1024 / 1024 / 1024
}

export function listTiers(): readonly SimplicioTier[] {
  return TIERS
}

/**
 * Picks the active Simplicio1 tier for this machine.
 *
 * Manual override via env `SIMPLICIO_MODEL_TIER` (one of the tier ids)
 * takes precedence; falls through to auto-selection otherwise.
 *
 * `hfBudgetRemainingUsd` is the caller's view of the HF budget. Pass 0 (or
 * omit) when the token is missing — the selector then skips the remote tier.
 */
export function selectTier(opts: {
  ramGb?: number
  hfTokenPresent?: boolean
  hfBudgetRemainingUsd?: number
  override?: string
} = {}): SimplicioTier {
  const override = opts.override ?? process.env.SIMPLICIO_MODEL_TIER
  if (override) {
    const found = TIERS.find((t) => t.id === override)
    if (found) return found
  }

  const ram = opts.ramGb ?? totalRamGb()
  const hasHf =
    (opts.hfTokenPresent ?? Boolean(process.env.HF_TOKEN)) &&
    (opts.hfBudgetRemainingUsd ?? 0) >= 0.1

  for (const tier of TIERS) {
    if (tier.kind === "remote") {
      if (hasHf) return tier
      continue
    }
    if ((tier.minRamGb ?? 0) <= ram) return tier
  }
  // Final fallback — return the smallest local tier so caller never crashes.
  return TIERS[TIERS.length - 1]
}
