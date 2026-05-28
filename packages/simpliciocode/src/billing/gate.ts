// Feature-gating between the free and Pro tiers of SimplicioCode.
// REQUIREMENT: #11 (R9).
//
// Free  : Simplicio1 (Qwen tiers, auto-selected) + manual /sprint run.
// Pro   : unlimited tokens on remote models + sendsprint watch (auto-sprints).

export type Plan = "free" | "pro"

export interface PlanCapabilities {
  remoteModels: boolean
  autoSprintWatcher: boolean
  unlimitedTokens: boolean
}

const CAPS: Record<Plan, PlanCapabilities> = {
  free: { remoteModels: false, autoSprintWatcher: false, unlimitedTokens: false },
  pro:  { remoteModels: true,  autoSprintWatcher: true,  unlimitedTokens: true },
}

export function capabilities(plan: Plan): PlanCapabilities {
  return CAPS[plan]
}

export function requirePro(plan: Plan, feature: keyof PlanCapabilities): void {
  if (!capabilities(plan)[feature]) {
    throw new ProRequiredError(feature)
  }
}

export class ProRequiredError extends Error {
  constructor(public readonly feature: keyof PlanCapabilities) {
    super(
      `Feature "${feature}" requires Simplicio1 Pro (US$20/month). ` +
        `Upgrade at https://opencode.ai/pro — see docs/EVOLUTION.md (R9).`,
    )
    this.name = "ProRequiredError"
  }
}

/**
 * Resolve the current user's plan from the environment.
 * Order: explicit SIMPLICIO_PLAN env > cached subscription status > "free".
 * Callers may pass a `lookup` to consult Stripe for authoritative status.
 */
export async function resolvePlan(
  opts: {
    lookup?: () => Promise<"active" | "canceled" | "none">
  } = {},
): Promise<Plan> {
  const override = process.env.SIMPLICIO_PLAN
  if (override === "pro" || override === "free") return override
  if (opts.lookup) {
    const status = await opts.lookup()
    if (status === "active") return "pro"
  }
  return "free"
}
