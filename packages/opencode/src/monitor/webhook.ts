/**
 * Webhook provider registry.
 *
 * 14 first-class providers + 1 generic endpoint. Each provider declares:
 *   - id              : stable key used in `monitor_alert_channel.type`
 *   - label           : display name for the Settings UI
 *   - resolveURL      : derive the destination URL from credentials (some
 *                       providers like Telegram / Opsgenie compute the URL
 *                       from the credential; others default it from input)
 *   - format          : turn an alert envelope into the provider's native
 *                       payload (Slack blocks, Discord embeds, PagerDuty
 *                       Events API v2, …)
 *   - credentialFields: list of credential inputs the UI should render
 *
 * The generic provider accepts any HTTPS URL and an optional HMAC-SHA256
 * secret for signing the JSON body.
 *
 * Delivery is detached from the alert path — see `delivery()` below —
 * with a request timeout and bounded retry/backoff, so a slow / wedged
 * webhook target can never block hook ingest.
 */

import { createHmac, timingSafeEqual } from "node:crypto"
import { z } from "zod"

export const ProviderID = z.enum([
  "slack",
  "discord",
  "teams",
  "google-chat",
  "mattermost",
  "rocketchat",
  "telegram",
  "pagerduty",
  "opsgenie",
  "splunk-oncall",
  "zapier",
  "make",
  "n8n",
  "pipedream",
  "generic",
])
export type ProviderID = z.infer<typeof ProviderID>

export const CredentialField = z.object({
  key: z.string(),
  label: z.string(),
  required: z.boolean(),
  secret: z.boolean(),
  help: z.string().optional(),
})
export type CredentialField = z.infer<typeof CredentialField>

export interface AlertEnvelope {
  id: string
  rule: { id: string; name: string }
  fired_at: number
  project_id: string
  session_id: string | null
  payload: Record<string, unknown>
}

export interface Provider {
  readonly id: ProviderID
  readonly label: string
  readonly credentialFields: CredentialField[]
  resolveURL(input: { credentials: Record<string, string>; explicitURL?: string }): string
  format(envelope: AlertEnvelope): { body: unknown; headers?: Record<string, string> }
}

const ok = (id: ProviderID, label: string, credentialFields: CredentialField[]): Provider => ({
  id,
  label,
  credentialFields,
  resolveURL: ({ explicitURL }) => explicitURL ?? "",
  format: (e) => ({ body: e }),
})

const slack: Provider = {
  id: "slack",
  label: "Slack",
  credentialFields: [CredentialField.parse({ key: "webhook_url", label: "Incoming Webhook URL", required: true, secret: true })],
  resolveURL: ({ explicitURL }) => explicitURL ?? "",
  format: (e) => ({
    body: {
      text: `*${e.rule.name}* fired`,
      blocks: [
        { type: "section", text: { type: "mrkdwn", text: `*${e.rule.name}*\n${JSON.stringify(e.payload, null, 2)}` } },
      ],
    },
  }),
}

const telegram: Provider = {
  id: "telegram",
  label: "Telegram",
  credentialFields: [
    CredentialField.parse({ key: "bot_token", label: "Bot token", required: true, secret: true }),
    CredentialField.parse({ key: "chat_id", label: "Chat ID", required: true, secret: false }),
  ],
  resolveURL: ({ credentials }) =>
    credentials.bot_token ? `https://api.telegram.org/bot${credentials.bot_token}/sendMessage` : "",
  format: (e) => ({
    body: { text: `*${e.rule.name}*\n\`\`\`${JSON.stringify(e.payload, null, 2)}\`\`\``, parse_mode: "Markdown" },
  }),
}

const pagerduty: Provider = {
  id: "pagerduty",
  label: "PagerDuty",
  credentialFields: [CredentialField.parse({ key: "routing_key", label: "Routing key", required: true, secret: true })],
  resolveURL: () => "https://events.pagerduty.com/v2/enqueue",
  format: (e) => ({
    body: {
      routing_key: undefined,
      event_action: "trigger",
      dedup_key: e.id,
      payload: {
        summary: `[${e.rule.name}] ${e.session_id ?? e.project_id}`,
        source: e.project_id,
        severity: "error",
        custom_details: e.payload,
      },
    },
  }),
}

const opsgenie: Provider = {
  id: "opsgenie",
  label: "Opsgenie",
  credentialFields: [
    CredentialField.parse({ key: "api_key", label: "API key (GenieKey)", required: true, secret: true }),
    CredentialField.parse({ key: "region", label: "Region (us/eu)", required: true, secret: false }),
  ],
  resolveURL: ({ credentials }) => {
    const region = credentials.region === "eu" ? "api.eu" : "api"
    return `https://${region}.opsgenie.com/`
  },
  format: (e) => ({ body: { message: e.rule.name, alias: e.id, description: JSON.stringify(e.payload) } }),
}

const splunkOncall: Provider = {
  id: "splunk-oncall",
  label: "Splunk On-Call",
  credentialFields: [CredentialField.parse({ key: "api_key", label: "API key", required: true, secret: true })],
  resolveURL: () => "https://events.pagerduty.com/v2/enqueue",
  format: pagerduty.format,
}

const generic: Provider = {
  id: "generic",
  label: "Generic webhook",
  credentialFields: [
    CredentialField.parse({ key: "url", label: "URL", required: true, secret: false }),
    CredentialField.parse({ key: "hmac_secret", label: "HMAC secret (optional)", required: false, secret: true }),
  ],
  resolveURL: ({ explicitURL, credentials }) => explicitURL ?? credentials.url ?? "",
  format: (e) => ({ body: e }),
}

const providers: Record<ProviderID, Provider> = {
  slack,
  discord: ok("discord", "Discord", [CredentialField.parse({ key: "webhook_url", label: "Webhook URL", required: true, secret: true })]),
  teams: ok("teams", "Microsoft Teams", [CredentialField.parse({ key: "webhook_url", label: "Connector URL", required: true, secret: true })]),
  "google-chat": ok("google-chat", "Google Chat", [CredentialField.parse({ key: "webhook_url", label: "Webhook URL", required: true, secret: true })]),
  mattermost: ok("mattermost", "Mattermost", [CredentialField.parse({ key: "webhook_url", label: "Incoming Webhook URL", required: true, secret: true })]),
  rocketchat: ok("rocketchat", "Rocket.Chat", [CredentialField.parse({ key: "webhook_url", label: "Webhook URL", required: true, secret: true })]),
  telegram,
  pagerduty,
  opsgenie,
  "splunk-oncall": splunkOncall,
  zapier: ok("zapier", "Zapier", [CredentialField.parse({ key: "webhook_url", label: "Catch Hook URL", required: true, secret: false })]),
  make: ok("make", "Make", [CredentialField.parse({ key: "webhook_url", label: "Webhook URL", required: true, secret: false })]),
  n8n: ok("n8n", "n8n", [CredentialField.parse({ key: "webhook_url", label: "Webhook URL", required: true, secret: false })]),
  pipedream: ok("pipedream", "Pipedream", [CredentialField.parse({ key: "webhook_url", label: "Workflow URL", required: true, secret: false })]),
  generic,
}

export function getProvider(id: ProviderID): Provider {
  return providers[id]
}

export function listProviders(): Provider[] {
  return Object.values(providers)
}

/**
 * Compute an HMAC-SHA256 signature over the JSON body. The digest is
 * returned as a hex string and is typically placed in the
 * `X-Monitor-Signature` header so the receiver can verify the request
 * without sharing the secret in the URL.
 */
export function signHmacSha256(body: string, secret: string): string {
  return createHmac("sha256", secret).update(body, "utf8").digest("hex")
}

/**
 * Constant-time equality for two hex digests of the same length. Used
 * by consumers to verify our `X-Monitor-Signature` header without
 * leaking information via early-exit string comparison.
 */
export function verifyHmacSha256(body: string, secret: string, signature: string): boolean {
  const expected = signHmacSha256(body, secret)
  if (expected.length !== signature.length) return false
  try {
    return timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(signature, "hex"))
  } catch {
    return false
  }
}

export interface DeliveryInput {
  url: string
  body: unknown
  headers?: Record<string, string>
  /** When set, the JSON body is HMAC-SHA256-signed with this secret and
   *  the digest is sent in `X-Monitor-Signature`. */
  hmacSecret?: string
  signal?: AbortSignal
  /** Total request timeout in ms. Default 10s. */
  timeoutMs?: number
  /** Max attempts including the first. Default 3. */
  maxAttempts?: number
}

export interface DeliveryResult {
  ok: boolean
  status?: number
  attempts: number
  error?: string
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(new Error("aborted"))
    const t = setTimeout(resolve, ms)
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(t)
        reject(new Error("aborted"))
      },
      { once: true },
    )
  })

/**
 * Detached webhook delivery. The function never throws — failures are
 * reported via the `DeliveryResult` return. The alert ingest path can
 * call this and move on.
 *
 *   attempt N
 *     ↓
 *   fetch with timeout
 *     ↓
 *   2xx → ok
 *   network / 5xx → backoff & retry up to maxAttempts
 *   4xx (except 408/429) → permanent fail, no retry
 */
export async function delivery(input: DeliveryInput): Promise<DeliveryResult> {
  const timeoutMs = input.timeoutMs ?? 10_000
  const maxAttempts = Math.max(1, input.maxAttempts ?? 3)
  const payload = JSON.stringify(input.body)
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "User-Agent": "opencode-monitor/0.0.1",
    ...input.headers,
  }
  if (input.hmacSecret) {
    headers["X-Monitor-Signature"] = signHmacSha256(payload, input.hmacSecret)
  }

  let lastError: string | undefined
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (input.signal?.aborted) return { ok: false, attempts: attempt, error: "aborted" }
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    input.signal?.addEventListener("abort", () => controller.abort(), { once: true })
    try {
      const res = await fetch(input.url, { method: "POST", body: payload, headers, signal: controller.signal })
      clearTimeout(timer)
      if (res.ok) return { ok: true, status: res.status, attempts: attempt }
      lastError = `${res.status} ${res.statusText}`
      // 4xx (except 408 / 429) is permanent — no retry.
      if (res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429) {
        return { ok: false, status: res.status, attempts: attempt, error: lastError }
      }
    } catch (err) {
      clearTimeout(timer)
      lastError = err instanceof Error ? err.message : String(err)
    }
    if (attempt < maxAttempts) {
      // Exponential backoff with jitter: 250ms, 500ms, 1000ms ± 100ms.
      const backoff = 250 * 2 ** (attempt - 1) + Math.random() * 100
      try {
        await sleep(backoff, input.signal)
      } catch {
        return { ok: false, attempts: attempt, error: "aborted" }
      }
    }
  }
  return { ok: false, attempts: maxAttempts, error: lastError ?? "unknown failure" }
}