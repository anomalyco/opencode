// Feature-gating across the SimplicioCode plan tiers.
// REQUIREMENTS: #11 (R9 — superseded), #12 (R10 — current spec).
//
// Tiers:
//   free  — app access only. Local Simplicio1 (Qwen). No remote tokens. No /sprint watch.
//   plus  — US$20/month. Unlimited tokens on remote Simplicio1 (DeepSeek + premium gateway).
//            Still no auto-sprint watcher.
//   pro   — US$50/month. Everything in plus, plus `sendsprint watch` (auto-sprints).
//
// Security: in production, plan is derived from a backend-issued JWT that
// proves an active Stripe subscription. The local cache lives in
// ~/.config/simplicio/auth.json. SIMPLICIO_PLAN env is a dev-only override
// and is rejected when NODE_ENV === "production" + SIMPLICIO_ENFORCE=1.

export type Plan = "free" | "plus" | "pro"

export interface PlanCapabilities {
  /** Use the Simplicio gateway for remote premium models (Claude/GPT/DeepSeek). */
  remoteModels: boolean
  /** `sendsprint watch` daemon mode — pulls cards 24/7. */
  autoSprintWatcher: boolean
  /** No per-token billing for the user (we eat the cost on the gateway). */
  unlimitedTokens: boolean
  /** Manual /sprint run available (free has it; just not the watcher). */
  manualSprintRun: boolean
}

const CAPS: Record<Plan, PlanCapabilities> = {
  free: {
    remoteModels: false,
    autoSprintWatcher: false,
    unlimitedTokens: false,
    manualSprintRun: true,
  },
  plus: {
    remoteModels: true,
    autoSprintWatcher: false,
    unlimitedTokens: true,
    manualSprintRun: true,
  },
  pro: {
    remoteModels: true,
    autoSprintWatcher: true,
    unlimitedTokens: true,
    manualSprintRun: true,
  },
}

export const PLAN_PRICE_USD_MONTH: Record<Plan, number> = {
  free: 0,
  plus: 20,
  pro: 50,
}

export function capabilities(plan: Plan): PlanCapabilities {
  return CAPS[plan]
}

export class PaidPlanRequiredError extends Error {
  constructor(
    public readonly feature: keyof PlanCapabilities,
    public readonly minPlan: Plan,
  ) {
    super(
      `Feature "${feature}" requires SimplicioCode ${minPlan === "pro" ? "Pro (US$50/mo)" : "Plus (US$20/mo)"}. ` +
        `Upgrade at https://opencode.ai/pricing.`,
    )
    this.name = "PaidPlanRequiredError"
  }
}

export function requireFeature(plan: Plan, feature: keyof PlanCapabilities): void {
  if (capabilities(plan)[feature]) return
  // Find the smallest plan that unlocks this feature.
  const min: Plan = CAPS.plus[feature] ? "plus" : "pro"
  throw new PaidPlanRequiredError(feature, min)
}

/**
 * Parse a JWT issued by the Simplicio backend.
 * Returns the claims when signature + expiry verify, null otherwise.
 *
 * The backend signs with HMAC SHA-256 using a key that lives only on the
 * server. Clients still verify the signature so a tampered cache file is
 * detected without a network round-trip.
 */
export interface SimplicioClaims {
  sub: string                     // Stripe customer id
  email: string
  plan: Plan
  exp: number                     // unix seconds
  iat: number
}

export async function verifyJwt(token: string, secret: string): Promise<SimplicioClaims | null> {
  const parts = token.split(".")
  if (parts.length !== 3) return null
  const [headerB64, payloadB64, sigB64] = parts as [string, string, string]
  try {
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign", "verify"],
    )
    const data = new TextEncoder().encode(`${headerB64}.${payloadB64}`)
    const signature = b64UrlDecode(sigB64)
    const ok = await crypto.subtle.verify("HMAC", key, signature, data)
    if (!ok) return null
    const claims = JSON.parse(new TextDecoder().decode(b64UrlDecode(payloadB64))) as SimplicioClaims
    if (claims.exp * 1000 < Date.now()) return null
    if (!isPlan(claims.plan)) return null
    return claims
  } catch {
    return null
  }
}

function isPlan(v: unknown): v is Plan {
  return v === "free" || v === "plus" || v === "pro"
}

function b64UrlDecode(s: string): Uint8Array {
  const pad = "=".repeat((4 - (s.length % 4)) % 4)
  const b64 = (s + pad).replace(/-/g, "+").replace(/_/g, "/")
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

/**
 * Resolve the active plan with strict security.
 *
 * Priority:
 *   1. Verified JWT from cache (signed by backend, contains `plan` claim).
 *   2. SIMPLICIO_PLAN env override (DEV ONLY — rejected when
 *      NODE_ENV=production and SIMPLICIO_ENFORCE=1).
 *   3. Default "free".
 *
 * The backend's JWT is the only source of truth in production. Cached
 * tokens older than `exp` cause downgrade to free until next login.
 */
export async function resolvePlan(opts: {
  jwt?: string
  jwtSecret?: string
  enforce?: boolean
} = {}): Promise<Plan> {
  if (opts.jwt && opts.jwtSecret) {
    const claims = await verifyJwt(opts.jwt, opts.jwtSecret)
    if (claims) return claims.plan
  }
  const enforce = opts.enforce ?? (process.env.NODE_ENV === "production" && process.env.SIMPLICIO_ENFORCE === "1")
  const override = process.env.SIMPLICIO_PLAN
  if (override && !enforce && (override === "free" || override === "plus" || override === "pro")) {
    return override
  }
  return "free"
}
