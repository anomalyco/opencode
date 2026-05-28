// Stripe billing for the Simplicio1 Pro plan ($20/month).
// REQUIREMENT: #11 (R9).
//
// Surface:
//   - createCheckoutSession({ customerEmail }) → URL to redirect the user.
//   - verifyWebhook(body, signature)            → typed event or null.
//   - subscriptionStatus({ customerId })        → "active" | "canceled" | "none".
//
// This module is intentionally framework-free: it talks to Stripe via fetch.
// The TUI / web app call into it. Keys come from env (see config.json#subscription.billing).

export type StripeEnv = {
  secretKey: string
  webhookSecret: string
  priceIdPro: string
  successUrl: string
  cancelUrl: string
}

export function readStripeEnv(): StripeEnv {
  return {
    secretKey: required("STRIPE_SECRET_KEY"),
    webhookSecret: required("STRIPE_WEBHOOK_SECRET"),
    priceIdPro: required("STRIPE_PRICE_ID_PRO"),
    successUrl: process.env.STRIPE_SUCCESS_URL ?? "https://opencode.ai/pro/success",
    cancelUrl: process.env.STRIPE_CANCEL_URL ?? "https://opencode.ai/pro/cancel",
  }
}

function required(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`Stripe billing not configured: missing env ${name}`)
  return v
}

const STRIPE_API = "https://api.stripe.com/v1"

async function call<T>(env: StripeEnv, path: string, body: URLSearchParams): Promise<T> {
  const res = await fetch(`${STRIPE_API}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.secretKey}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Stripe ${path} failed: ${res.status} ${text}`)
  }
  return res.json() as Promise<T>
}

export interface CheckoutSession {
  id: string
  url: string
}

export async function createCheckoutSession(
  env: StripeEnv,
  opts: { customerEmail?: string; clientReferenceId?: string },
): Promise<CheckoutSession> {
  const body = new URLSearchParams()
  body.set("mode", "subscription")
  body.set("line_items[0][price]", env.priceIdPro)
  body.set("line_items[0][quantity]", "1")
  body.set("success_url", env.successUrl)
  body.set("cancel_url", env.cancelUrl)
  if (opts.customerEmail) body.set("customer_email", opts.customerEmail)
  if (opts.clientReferenceId) body.set("client_reference_id", opts.clientReferenceId)
  return call<CheckoutSession>(env, "/checkout/sessions", body)
}

export interface Subscription {
  id: string
  status: "active" | "canceled" | "past_due" | "incomplete" | "trialing" | "unpaid"
  current_period_end: number
  cancel_at_period_end: boolean
}

export async function listSubscriptions(env: StripeEnv, customerId: string): Promise<Subscription[]> {
  const url = `${STRIPE_API}/subscriptions?customer=${encodeURIComponent(customerId)}&status=all&limit=10`
  const res = await fetch(url, { headers: { Authorization: `Bearer ${env.secretKey}` } })
  if (!res.ok) throw new Error(`Stripe list subs failed: ${res.status}`)
  const json = (await res.json()) as { data: Subscription[] }
  return json.data
}

export type SubscriptionStatus = "active" | "canceled" | "none"

export async function subscriptionStatus(env: StripeEnv, customerId: string): Promise<SubscriptionStatus> {
  const subs = await listSubscriptions(env, customerId)
  if (subs.some((s) => s.status === "active" || s.status === "trialing")) return "active"
  if (subs.some((s) => s.status === "canceled" || s.status === "past_due" || s.status === "unpaid")) return "canceled"
  return "none"
}

/**
 * Verify the Stripe webhook signature header.
 * Implements the t= / v1= scheme without pulling the Stripe SDK.
 * Returns the parsed event or null when signature mismatches.
 */
export async function verifyWebhook(
  env: StripeEnv,
  rawBody: string,
  signatureHeader: string,
  toleranceSec = 300,
): Promise<{ id: string; type: string; data: { object: Record<string, unknown> } } | null> {
  const parts = Object.fromEntries(
    signatureHeader.split(",").map((p) => p.split("=") as [string, string]),
  )
  const t = parts["t"]
  const v1 = parts["v1"]
  if (!t || !v1) return null
  const ageSec = Math.abs(Date.now() / 1000 - Number(t))
  if (ageSec > toleranceSec) return null

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(env.webhookSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  )
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${t}.${rawBody}`))
  const expected = Array.from(new Uint8Array(mac))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
  if (expected !== v1) return null

  return JSON.parse(rawBody)
}
