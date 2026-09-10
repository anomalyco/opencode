// Muse Code subscription provider.
//
// Same https://api.meta.ai/v1 API and shared Meta Responses protocol as the
// Meta API-key provider, but authenticated with a subscription-minted
// inference key from Meta device authorization. It never reads META_API_KEY
// and never falls back to it: without an explicit key every request fails
// closed with MissingCredentialError.
//
// Device authorization, key exchange, and quota parsing below are adapted
// from oh-my-pi PR #10677 (eggpeat/oh-my-pi @ 6785d70d, MIT).
import type { ProviderPackage } from "../provider-package.js"
import { MetaResponses } from "../protocols/meta-responses.js"
import { optional as optionalSecret } from "../route/auth.js"
import { type ProviderAuthOption } from "../route/auth-options.js"
import { Route, type RouteDefaultsInput } from "../route/client.js"
import { Endpoint } from "../route/endpoint.js"
import { HttpOptions, ProviderID, type ModelID } from "../schema/index.js"
import type { OpenResponsesProviderOptionsInput } from "./open-responses-options.js"

export const id = ProviderID.make("muse-code")
const baseURL = "https://api.meta.ai/v1"

const deviceAuthorizationURL = "https://auth.meta.com/oidc/device/authorization/"
const deviceTokenURL = "https://auth.meta.com/oidc/device/token/"
const subscriptionKeyURL = "https://api.meta.ai/muse-code/key"
const modelDiscoveryURL = "https://api.meta.ai/v1/models"
// Verified Meta client identity for the Muse Code device flow.
const clientID = "1031625952748946"
const headers = { Accept: "application/json", "x-api-version": "1.0.0" } as const

// Single owner for Muse model policy. Effort order is weakest to strongest;
// `max` is exposed last only on muse-spark-1.3. Display labels are short —
// API IDs are unchanged, and Contributor models keep their suffix because
// their prompts may be used for training.
export const EFFORTS = ["minimal", "low", "medium", "high", "xhigh"] as const
export const NAMES = {
  "muse-spark-1.1": "Spark 1.1",
  "muse-spark-1.2": "Spark 1.2",
  "muse-spark-1.2-contributor": "Spark 1.2 Contributor",
  "muse-spark-1.3": "Spark 1.3",
  "muse-spark-1.3-contributor": "Spark 1.3 Contributor",
} as const
export const KNOWN_IDS = Object.keys(NAMES)
export const LIMITS = { context: 1_048_576, output: 131_072 } as const

export const effortsFor = (modelID: string): string[] =>
  modelID === "muse-spark-1.3" ? [...EFFORTS, "max"] : [...EFFORTS]

export const variantSettings = (effort: string) => ({
  reasoningEffort: effort,
  reasoningSummary: "auto" as const,
  include: ["reasoning.encrypted_content"],
})

export interface DeviceAuthorization {
  readonly deviceCode: string
  readonly userCode: string
  readonly url: string
  readonly instructions: string
  readonly expiresIn: number
  readonly intervalMs: number
}

export interface SubscriptionKey {
  readonly apiKey?: string
  readonly accountID?: string
  readonly active: boolean
}

export interface QuotaWindow {
  readonly window: string
  readonly usedPercent: number
  readonly durationMinutes?: number
  readonly resetsAt?: string
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const text = (value: unknown, what: string): string => {
  if (typeof value !== "string" || value.trim() === "" || /[\r\n\x00]/.test(value))
    throw new Error(`Muse Code returned a missing or invalid ${what}.`)
  return value
}

const allowedURLs = new Set([deviceAuthorizationURL, deviceTokenURL, subscriptionKeyURL, modelDiscoveryURL])

async function fetchJSON(fetchFn: typeof fetch, url: string, init: RequestInit, signal?: AbortSignal) {
  if (!allowedURLs.has(url)) throw new Error("Muse Code refused an unverified destination.")
  let response: Response
  try {
    response = await fetchFn(url, { ...init, redirect: "error", signal })
  } catch {
    if (signal?.aborted) throw new Error("Muse Code request cancelled.")
    throw new Error("Muse Code network request failed or timed out. Retry when connectivity is restored.")
  }
  if (response.status === 429) throw new Error("Muse Code is rate limited. Wait before retrying.")
  if (response.status === 401)
    throw new Error("Muse Code authorization expired or was revoked. Reconnect the subscription.")
  if (response.status === 402)
    throw new Error("Muse Code requires a subscription payment action. Check billing in your Meta account.")
  if (response.status === 403)
    throw new Error("Muse Code subscription access denied. Check that your subscription is active, then reconnect.")
  if (!response.ok) throw new Error(`Muse Code request failed (HTTP ${response.status}).`)
  try {
    const payload: unknown = await response.json()
    if (!isRecord(payload)) throw new Error("malformed")
    return payload
  } catch {
    throw new Error("Muse Code returned malformed data.")
  }
}

export const startDeviceAuthorization = async (
  fetchFn: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<DeviceAuthorization> => {
  const device = await fetchJSON(
    fetchFn,
    deviceAuthorizationURL,
    {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: clientID }).toString(),
    },
    signal,
  )
  const url = new URL(text(device["verification_uri_complete"] ?? device["verification_uri"], "authorization URL"))
  if (url.origin !== "https://auth.meta.com" || url.username || url.password)
    throw new Error("Muse Code returned an unverified authorization URL.")
  const expiresIn = Number(device["expires_in"])
  if (!Number.isFinite(expiresIn) || expiresIn <= 0 || expiresIn > 86_400)
    throw new Error("Muse Code returned an invalid device expiry.")
  const interval = device["interval"] === undefined ? 5 : Number(device["interval"])
  if (!Number.isFinite(interval) || interval <= 0) throw new Error("Muse Code returned an invalid polling interval.")
  const userCode = text(device["user_code"], "user code")
  return {
    deviceCode: text(device["device_code"], "device code"),
    userCode,
    url: url.toString(),
    instructions: `Enter code: ${userCode}.`,
    expiresIn,
    intervalMs: Math.max(1000, Math.floor(interval * 1000)),
  }
}

// The token endpoint reports poll states as JSON bodies on non-2xx
// responses, so it reads the payload before mapping HTTP states.
async function postTokenPayload(fetchFn: typeof fetch, deviceCode: string, signal?: AbortSignal) {
  if (!allowedURLs.has(deviceTokenURL)) throw new Error("Muse Code refused an unverified destination.")
  let response: Response
  try {
    response = await fetchFn(deviceTokenURL, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientID,
        device_code: deviceCode,
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      }).toString(),
      redirect: "error",
      signal,
    })
  } catch {
    if (signal?.aborted) throw new Error("Muse Code login cancelled.")
    throw new Error("Muse Code network request failed or timed out. Retry when connectivity is restored.")
  }
  let payload: unknown
  try {
    payload = await response.json()
  } catch {
    throw new Error("Muse Code returned malformed token data.")
  }
  if (!isRecord(payload)) throw new Error("Muse Code returned malformed token data.")
  return { status: response.status, payload }
}

export const pollDeviceToken = async (
  deviceCode: string,
  fetchFn: typeof fetch = fetch,
  opts: { intervalMs: number; deadline: number; now?: () => number; wait?: (ms: number) => Promise<void>; signal?: AbortSignal } = {
    intervalMs: 5000,
    deadline: Number.POSITIVE_INFINITY,
  },
): Promise<string> => {
  const now = opts.now ?? Date.now
  const wait = opts.wait ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)))
  let interval = opts.intervalMs
  while (now() < opts.deadline) {
    if (opts.signal?.aborted) throw new Error("Muse Code login cancelled.")
    await wait(Math.min(interval, opts.deadline - now())).catch(() => {
      throw new Error("Muse Code login cancelled.")
    })
    if (now() >= opts.deadline || opts.signal?.aborted) throw new Error("Muse Code login cancelled.")
    const { status, payload } = await postTokenPayload(fetchFn, deviceCode, opts.signal)
    if (payload["error"] === "authorization_pending") continue
    if (payload["error"] === "slow_down") {
      interval += 5000
      continue
    }
    if (payload["error"] === "access_denied")
      throw new Error("Muse Code device authorization denied. Start a new login if this was unintended.")
    if (payload["error"] === "expired_token") break
    if (status === 429) throw new Error("Muse Code is rate limited. Wait before retrying.")
    if (status === 401)
      throw new Error("Muse Code authorization expired or was revoked. Reconnect the subscription.")
    if (status === 402)
      throw new Error("Muse Code requires a subscription payment action. Check billing in your Meta account.")
    if (status === 403)
      throw new Error("Muse Code subscription access denied. Check that your subscription is active, then reconnect.")
    if (status !== 200 || payload["error"])
      throw new Error(`Muse Code device authorization failed (HTTP ${status}). Start a new login.`)
    return text(payload["access_token"], "account token")
  }
  throw new Error("Muse Code device code expired. Start a new login.")
}

export const exchangeSubscriptionKey = async (
  accountToken: string,
  onboard: boolean,
  fetchFn: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<SubscriptionKey> => {
  const payload = await fetchJSON(
    fetchFn,
    subscriptionKeyURL,
    {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json", Authorization: `Bearer ${accountToken}` },
      body: JSON.stringify(onboard ? { onboard: true } : {}),
    },
    signal,
  )
  if (payload["is_subs_active"] !== undefined && typeof payload["is_subs_active"] !== "boolean")
    throw new Error("Muse Code returned malformed subscription status.")
  if (payload["is_subs_active"] === false)
    throw new Error("Muse Code subscription is inactive. Activate it in your Meta account, then reconnect.")
  if (payload["require_payment"] === true || payload["action_url"] || payload["require_payment_action_url"])
    throw new Error("Muse Code requires a subscription or billing action. Check billing in your Meta account.")
  // Only the onboard exchange returns an inference key and identity; quota
  // lookups must never satisfy authentication.
  if (!onboard) return { active: payload["is_subs_active"] !== false }
  const apiKey = payload["api_key"]
  const accountID = payload["user_id"] ?? payload["user_email"]
  return { apiKey: text(apiKey, "subscription key"), accountID: text(accountID, "account identity"), active: true }
}

// Account-entitled model IDs from the subscription key. Callers intersect
// with KNOWN_IDS; unknown revisions are reported, never given guessed
// capabilities.
export const discoverModelIDs = async (
  apiKey: string,
  fetchFn: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<{ entitled: string[]; unknown: string[] }> => {
  const payload = await fetchJSON(
    fetchFn,
    modelDiscoveryURL,
    { headers: { ...headers, Authorization: `Bearer ${apiKey}` }, signal },
    signal,
  )
  if (!Array.isArray(payload["data"])) throw new Error("Muse Code model discovery returned malformed data.")
  const entitled: string[] = []
  const unknown: string[] = []
  for (const row of payload["data"]) {
    if (!isRecord(row) || typeof row["id"] !== "string") throw new Error("Muse Code model discovery returned malformed data.")
    if (KNOWN_IDS.includes(row["id"])) entitled.push(row["id"])
    else unknown.push(row["id"])
  }
  return { entitled, unknown }
}

export const quotaOf = (payload: Record<string, unknown>): QuotaWindow[] => {
  const windows: QuotaWindow[] = []
  const usage = payload["subs_usage"]
  if (!isRecord(usage)) return windows
  for (const name of ["window", "weekly"]) {
    const value = usage[name]
    if (!isRecord(value) || typeof value["used_percent"] !== "number" || value["used_percent"] < 0) continue
    const resets = value["resets_at"]
    const millis =
      typeof resets === "number"
        ? resets * (resets < 1_000_000_000_000 ? 1000 : 1)
        : typeof resets === "string"
          ? Date.parse(resets)
          : Number.NaN
    windows.push({
      window: name,
      usedPercent: value["used_percent"],
      ...(typeof value["window_duration_mins"] === "number" && value["window_duration_mins"] > 0
        ? { durationMinutes: value["window_duration_mins"] }
        : {}),
      ...(Number.isFinite(millis) && millis > 0 && Number.isFinite(new Date(millis).getTime())
        ? { resetsAt: new Date(millis).toISOString() }
        : {}),
    })
  }
  return windows
}

export type ProviderOptionsInput = OpenResponsesProviderOptionsInput

export type LanguageModelOptions = Omit<RouteDefaultsInput, "providerOptions"> &
  ProviderAuthOption<"optional"> & {
    readonly baseURL?: string
    readonly providerOptions?: ProviderOptionsInput
  }

export interface Settings extends ProviderPackage.Settings {
  readonly apiKey?: string
  readonly baseURL?: string
  readonly providerOptions?: ProviderOptionsInput
}

const responsesRoute = Route.make({
  id: "muse-code-responses",
  provider: id,
  providerMetadataKey: "muse-code",
  protocol: MetaResponses.protocol,
  endpoint: Endpoint.path("/responses", { baseURL }),
  // Meta Responses does not support WebSocket upgrades; always use HTTP/SSE.
  transport: MetaResponses.httpTransport,
  defaults: { providerOptions: { store: false, include: ["reasoning.encrypted_content"] } },
})

export const routes = [responsesRoute]

const subscriptionAuth = (input: ProviderAuthOption<"optional">) =>
  "auth" in input && input.auth ? input.auth : optionalSecret(input.apiKey, "muse-code subscription").bearer()

export const configure = (input: LanguageModelOptions = {}) => {
  const { apiKey: _apiKey, auth: _auth, baseURL: endpoint, ...defaults } = input
  const options = {
    ...defaults,
    endpoint: { baseURL: endpoint ?? baseURL },
    auth: subscriptionAuth(input),
  }
  const configuredResponses = responsesRoute.with(options)
  const responses = (modelID: string | ModelID) =>
    configuredResponses.model<OpenResponsesProviderOptionsInput>({ id: modelID })
  return { id, model: responses, responses, configure }
}

export const provider = configure()
export const responses = provider.responses

export const model: ProviderPackage.Definition<Settings, OpenResponsesProviderOptionsInput>["model"] = (
  modelID,
  settings,
) => fromSettings(settings).responses(modelID)

function fromSettings(settings: Settings) {
  return configure({
    apiKey: settings.apiKey,
    baseURL: settings.baseURL,
    headers: settings.headers,
    http: settings.body === undefined ? undefined : { body: { ...settings.body } },
    providerOptions: settings.providerOptions,
  })
}

export * as MuseCode from "./muse-code.js"
