/**
 * GitHub connector — implemented in the desktop main process.
 *
 * Auth strategy: GitHub Device Flow (RFC 8628), the same flow used by `gh` CLI.
 * - No local callback server, no redirect URI, no client secret needed.
 * - The user authorizes THEIR OWN GitHub account from their browser.
 * - The access token is stored encrypted (Electron safeStorage) in the settings store.
 *
 * The renderer never sees the device_code or the access token: the device_code
 * lives in main-process memory during an attempt, and the token is encrypted on
 * disk. The renderer only receives the user_code (to show) and the poll result.
 */

import { randomUUID } from "node:crypto"
import { app, safeStorage } from "electron"
import type { DeviceFlowPoll, DeviceFlowStart, GitHubConnectorStatus, GitHubUser } from "@opencode-ai/app/connectors/types"
import { getStore } from "./store"

export const GITHUB_CLIENT_ID = "Ov23lifxOge1pqQvTnyB"
const GITHUB_SCOPES = "repo,user"
const GITHUB_API = "https://api.github.com"

// Device-flow endpoints (RFC 8628). These do NOT allow CORS, which is why the
// flow must run in the main process instead of the renderer.
const DEVICE_CODE_URL = "https://github.com/login/device/code"
const TOKEN_URL = "https://github.com/login/oauth/access_token"

// Settings store keys (electron-store, JSON in userData).
const KEY_ENABLED = "connector.github.enabled"
const KEY_TOKEN = "connector.github.token.encrypted" // base64(safeStorage.encryptString(token))
const KEY_USER = "connector.github.user" // JSON of public GitHubUser (not a secret)

type DeviceSession = {
  device_code: string
  interval: number
  expires_at: number
}

/** In-memory device-flow attempts keyed by opaque session id. */
const deviceSessions = new Map<string, DeviceSession>()

/** Allowed origin for the Authorization header on api.github.com calls. */
const ghJsonHeaders = (token?: string): Record<string, string> => ({
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
  ...(token ? { Authorization: `Bearer ${token}` } : {}),
})

// ── Encrypted token storage ──

function store() {
  return getStore()
}

/**
 * safeStorage.isEncryptionAvailable() can be true while the backend is
 * `basic_text` (Linux without a keyring) — obfuscation, not real encryption.
 * Refuse to store the token in that case instead of leaking it in plaintext.
 */
function encryptionAvailable(): boolean {
  if (!safeStorage.isEncryptionAvailable()) return false
  const backend = (safeStorage as { getSelectedStorageBackend?: () => string }).getSelectedStorageBackend
  if (typeof backend === "function" && backend.call(safeStorage) === "basic_text") return false
  return true
}

function encryptToken(token: string): string {
  if (!encryptionAvailable()) {
    // Fallback: plaintext would be insecure; refuse instead of leaking.
    throw new Error("safeStorage encryption is not available on this system")
  }
  return safeStorage.encryptString(token).toString("base64")
}

function decryptToken(encrypted: string): string | null {
  try {
    const buf = Buffer.from(encrypted, "base64")
    if (!encryptionAvailable()) return null
    return safeStorage.decryptString(buf)
  } catch {
    return null
  }
}

function getStoredToken(): string | null {
  const enc = store().get(KEY_TOKEN) as string | undefined
  if (!enc) return null
  return decryptToken(enc)
}

function storeToken(token: string | null) {
  if (token === null) {
    store().delete(KEY_TOKEN)
    store().delete(KEY_USER)
    return
  }
  store().set(KEY_TOKEN, encryptToken(token))
}

function getStoredUser(): GitHubUser | undefined {
  const raw = store().get(KEY_USER) as string | undefined
  if (!raw) return undefined
  try {
    return JSON.parse(raw) as GitHubUser
  } catch {
    return undefined
  }
}

// ── GitHub API calls ──

async function fetchUser(token: string): Promise<GitHubUser> {
  const res = await fetch(`${GITHUB_API}/user`, { headers: ghJsonHeaders(token) })
  if (!res.ok) throw new Error(`GitHub API error: ${res.status}`)
  const data = (await res.json()) as { login: string; avatar_url: string; name?: string }
  return { login: data.login, avatar: data.avatar_url, name: data.name }
}

async function postForm(url: string, body: Record<string, string>): Promise<Record<string, unknown>> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams(body),
  })
  return (await res.json()) as Record<string, unknown>
}

// ── Status ──

export async function githubStatus(): Promise<GitHubConnectorStatus> {
  const enabled = Boolean(store().get(KEY_ENABLED))
  const token = getStoredToken()
  const user = getStoredUser()
  return { enabled, connected: token !== null, user }
}

export async function githubSetEnabled(enabled: boolean): Promise<GitHubConnectorStatus> {
  store().set(KEY_ENABLED, enabled)
  return githubStatus()
}

// ── Device flow ──

export async function githubStartDeviceFlow(): Promise<DeviceFlowStart> {
  const data = await postForm(DEVICE_CODE_URL, {
    client_id: GITHUB_CLIENT_ID,
    scope: GITHUB_SCOPES,
  })

  const device_code = String(data.device_code ?? "")
  const user_code = String(data.user_code ?? "")
  const verification_uri = String(data.verification_uri ?? "https://github.com/login/device")
  const interval = Number(data.interval ?? 5)
  const expires_in = Number(data.expires_in ?? 900)

  if (!device_code || !user_code) {
    throw new Error(`GitHub device flow failed: ${JSON.stringify(data)}`)
  }

  const sessionId = randomUUID()
  deviceSessions.set(sessionId, {
    device_code,
    interval,
    expires_at: Date.now() + expires_in * 1000,
  })

  return { sessionId, userCode: user_code, verificationUri: verification_uri, interval, expiresIn: expires_in }
}

export async function githubPollDeviceFlow(sessionId: string): Promise<DeviceFlowPoll> {
  const session = deviceSessions.get(sessionId)
  if (!session) return { status: "error", message: "Session not found or already finished" }
  if (Date.now() > session.expires_at) {
    deviceSessions.delete(sessionId)
    return { status: "expired" }
  }

  const data = await postForm(TOKEN_URL, {
    client_id: GITHUB_CLIENT_ID,
    device_code: session.device_code,
    grant_type: "urn:ietf:params:oauth:grant-type:device_code",
  })

  const error = data.error
  if (error === "authorization_pending") return { status: "pending" }
  if (error === "slow_down") return { status: "pending", slowDown: true }
  if (error === "expired_token") {
    deviceSessions.delete(sessionId)
    return { status: "expired" }
  }
  if (error === "access_denied") {
    deviceSessions.delete(sessionId)
    return { status: "denied" }
  }
  if (error) {
    deviceSessions.delete(sessionId)
    return { status: "error", message: String(data.error_description ?? error) }
  }

  const accessToken = String(data.access_token ?? "")
  if (!accessToken) return { status: "error", message: "No access_token in response" }

  deviceSessions.delete(sessionId)

  try {
    const user = await fetchUser(accessToken)
    storeToken(accessToken)
    store().set(KEY_USER, JSON.stringify(user))
    store().set(KEY_ENABLED, true)
    return { status: "success", user }
  } catch (err) {
    return { status: "error", message: err instanceof Error ? err.message : String(err) }
  }
}

export async function githubDisconnect(): Promise<GitHubConnectorStatus> {
  storeToken(null)
  store().delete(KEY_USER)
  // Keep `enabled` as-is: disconnecting does not disable the connector.
  return githubStatus()
}

// ── Cleanup ──

/** Call on app quit so in-memory device sessions don't linger across restarts. */
export function clearDeviceSessions() {
  deviceSessions.clear()
}

/** Load any pre-existing user so the UI can show "connected" at startup. */
export function githubStartupHook() {
  void app.whenReady().then(() => {
    // Touch the store eagerly so decrypt failures surface early (and clear).
    if (getStoredToken() === null && store().get(KEY_TOKEN)) {
      store().delete(KEY_TOKEN)
      store().delete(KEY_USER)
    }
  })
}
