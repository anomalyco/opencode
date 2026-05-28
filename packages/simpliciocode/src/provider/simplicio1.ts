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
  provider: "simplicio1" | "simplicio1-pro"
  /** Underlying engine. Hidden from the model picker. */
  backend: "ollama" | "huggingface"
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
    label: "Simplicio1 Pro — DeepSeek V4 Pro (HF • budget $5)",
    provider: "simplicio1-pro",
    backend: "huggingface",
    model: "deepseek-ai/DeepSeek-V4-Pro",
    baseUrl: "https://api-inference.huggingface.co/v1",
    envToken: "HF_TOKEN",
    budgetUsd: 5.0,
    kind: "remote",
  },
  {
    id: "14b",
    label: "Simplicio1 14B (Free • Local)",
    provider: "simplicio1",
    backend: "ollama",
    model: "qwen2.5-coder:14b",
    baseUrl: "http://localhost:11434/v1",
    minRamGb: 16,
    kind: "local",
  },
  {
    id: "7b",
    label: "Simplicio1 7B (Free • Local)",
    provider: "simplicio1",
    backend: "ollama",
    model: "qwen2.5-coder:7b",
    baseUrl: "http://localhost:11434/v1",
    minRamGb: 8,
    kind: "local",
  },
  {
    id: "3b",
    label: "Simplicio1 3B (Free • Local)",
    provider: "simplicio1",
    backend: "ollama",
    model: "qwen2.5-coder:3b",
    baseUrl: "http://localhost:11434/v1",
    minRamGb: 4,
    kind: "local",
  },
  {
    id: "1.5b",
    label: "Simplicio1 1.5B (Free • Local)",
    provider: "simplicio1",
    backend: "ollama",
    model: "qwen2.5-coder:1.5b",
    baseUrl: "http://localhost:11434/v1",
    minRamGb: 2,
    kind: "local",
  },
]

export function totalRamGb(): number {
  return os.totalmem() / 1024 / 1024 / 1024
}

/**
 * Fetches the remaining HuggingFace Inference budget in USD.
 * Returns 0 when the token is missing or the call fails — selectTier()
 * treats either case as "no remote budget".
 *
 * Uses the billing summary endpoint. HF doesn't publish a per-request
 * cost field in the public API, so we parse `total_spent` and subtract
 * from the configured cap (default $5).
 */
export async function fetchHfBudgetRemaining(opts: { capUsd?: number; token?: string } = {}): Promise<number> {
  const cap = opts.capUsd ?? 5
  const token = opts.token ?? process.env.HF_TOKEN
  if (!token) return 0
  try {
    const res = await fetch("https://huggingface.co/api/billing/usage", {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!res.ok) return 0
    const json = (await res.json()) as { total_spent?: number }
    const spent = json.total_spent ?? 0
    return Math.max(0, cap - spent)
  } catch {
    return 0
  }
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
