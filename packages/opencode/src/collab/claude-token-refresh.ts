/**
 * Auto-refresh shim for Claude OAuth credentials.
 *
 * The upstream `opencode-claude-auth` plugin reads the canonical credentials
 * file (`~/.claude/.credentials.json` — symlinked to the EFS path by the
 * entrypoint) and hands the `accessToken` to the Anthropic SDK.  But:
 *
 *   1. The plugin caches at module load.  When a user uploads a new
 *      credentials JSON mid-session via /collab/claude-creds, the bytes on
 *      disk update but the plugin's in-memory state stays stale until the
 *      next container restart.
 *
 *   2. Anthropic's OAuth access tokens are short-lived (~15 min in current
 *      configuration).  The plugin's own refresh-on-401 path is unreliable
 *      enough that we've observed 401s with non-expired client-side
 *      `expiresAt`s.  Production symptom: every ~15 min of idle, the next
 *      prompt fails with "Invalid authentication credentials" until a
 *      restart.
 *
 * This module:
 *
 *   - Reads the on-disk credentials.
 *   - If `claudeAiOauth.expiresAt` is within `EXPIRY_BUFFER_MS` of now,
 *     POSTs `grant_type=refresh_token` to Anthropic's OAuth token endpoint
 *     and writes the new `{access_token, refresh_token, expires_in}` back
 *     to disk atomically.
 *   - Returns the (now-fresh) access token, or null when refresh failed
 *     (caller can fall back to `ANTHROPIC_API_KEY` env).
 *
 * Called from two hot paths:
 *
 *   - `serve.ts` at boot, before the HTTP listener comes up — so the
 *     plugin's startup read sees fresh creds.
 *   - The collab queue executor in `router.ts`, before every
 *     `executePromptOnNativeSession` call — so mid-session refreshes keep
 *     the file fresh for the plugin's NEXT read (whenever that fires).
 *
 * Concurrency: multiple parallel prompts dispatching at once must not
 * trigger N parallel refreshes (would race on file writes + waste OAuth
 * round-trips).  An in-flight Promise is shared across concurrent
 * callers; first call drives the work, subsequent callers await it.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "fs"
import { dirname } from "path"
import { credentialsPath } from "./claude-credentials"

// ── Configuration ──────────────────────────────────────────────────────────

/**
 * Anthropic's OAuth token endpoint.  Overridable for testing / future endpoint
 * changes.  Default matches what Claude Code uses today.
 */
const REFRESH_URL =
  process.env["CLAUDE_OAUTH_TOKEN_URL"] ?? "https://console.anthropic.com/v1/oauth/token"

/**
 * Claude Code's public OAuth client ID.  Publicly documented; tokens
 * minted for OTHER client IDs cannot be refreshed via this endpoint.
 * Overridable via env so an operator can rotate without a code change
 * if Anthropic ever rotates client registration.
 */
const CLIENT_ID =
  process.env["CLAUDE_OAUTH_CLIENT_ID"] ?? "9d1c250a-e61b-44d9-88ed-5944d1962f5e"

/**
 * Refresh proactively when the access token is within this many ms of
 * expiry.  60 s is generous enough that the refreshed token will outlive
 * a typical LLM prompt's wall-clock (~30 s) by 10x without forcing a
 * mid-flight retry; tighter would mean more refresh round-trips against
 * Anthropic's endpoint for negligible benefit.
 */
const EXPIRY_BUFFER_MS = 60_000

// ── Module state ───────────────────────────────────────────────────────────

/**
 * In-flight refresh.  Concurrent callers share this Promise so only one
 * actual OAuth round-trip happens at a time.  Cleared in `finally` so
 * the NEXT call re-evaluates whether a refresh is needed (rather than
 * caching a now-stale return value).
 */
let inFlight: Promise<string | null> | null = null

// ── Types ──────────────────────────────────────────────────────────────────

/** Subset of the credentials file's `claudeAiOauth` block we care about. */
interface ClaudeOauth {
  accessToken: string
  refreshToken: string
  /** Epoch ms — when the current `accessToken` expires Anthropic-side. */
  expiresAt?: number
  // Other keychain fields (scopes, subscriptionType, rateLimitTier) are
  // preserved through refresh; we don't read them here but the spread
  // in writeBack() keeps them in place.
  [k: string]: unknown
}

/** Top-level credentials file shape (keychain-nested, the only shape this
 *  module supports — flat shapes lack `expiresAt` so refresh can't be
 *  triggered reactively).  Other top-level keys like `mcpOAuth` pass
 *  through untouched. */
interface CredentialsFile {
  claudeAiOauth?: ClaudeOauth
  [k: string]: unknown
}

interface RefreshResponse {
  access_token: string
  refresh_token: string
  /** Seconds until the new `access_token` expires. */
  expires_in: number
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Ensure the on-disk Claude OAuth access token is valid for the next
 * prompt.  Refreshes via Anthropic's OAuth token endpoint when expired
 * or close to expiry; returns the now-fresh access token, or null when
 * any step fails (file missing, wrong shape, refresh 4xx, network error).
 *
 * The caller is the prompt-dispatch path.  When this returns null AND
 * `ANTHROPIC_API_KEY` is set, the Anthropic SDK falls back to env on its
 * own — the caller doesn't need to thread the return value anywhere.
 * When BOTH this returns null AND no env key is set, the SDK throws
 * "Anthropic API key is missing" and the prompt fails fast.
 *
 * Idempotent and safe to call on every prompt: tokens still well within
 * their validity window short-circuit at the expiry check and skip the
 * OAuth round-trip.
 */
export async function ensureFreshClaudeToken(): Promise<string | null> {
  if (inFlight) return inFlight
  inFlight = (async () => {
    try {
      return await refreshIfNeeded()
    } finally {
      inFlight = null
    }
  })()
  return inFlight
}

// ── Internals ──────────────────────────────────────────────────────────────

async function refreshIfNeeded(): Promise<string | null> {
  const path = credentialsPath()
  if (!existsSync(path)) {
    // No file at all → nothing to refresh.  Plugin will fall through to
    // ANTHROPIC_API_KEY env (or fail) on its own.
    return null
  }

  let raw: string
  try {
    raw = readFileSync(path, "utf8")
  } catch (err) {
    console.warn(`[claude-refresh] read failed for ${path}:`, err)
    return null
  }

  let creds: CredentialsFile
  try {
    creds = JSON.parse(raw) as CredentialsFile
  } catch (err) {
    console.warn(`[claude-refresh] JSON parse failed for ${path}:`, err)
    return null
  }

  const oauth = creds.claudeAiOauth
  if (!oauth || typeof oauth.accessToken !== "string" || typeof oauth.refreshToken !== "string") {
    // Flat-shape credentials don't carry expiresAt.  We could refresh
    // pessimistically on every call, but that's a high-frequency external
    // dependency for marginal benefit (a flat-shape file is already
    // by-construction missing refresh-time metadata; whoever uploaded it
    // is probably operating in a different OAuth model).  Skip refresh.
    return null
  }

  const now = Date.now()
  if (typeof oauth.expiresAt === "number" && oauth.expiresAt > now + EXPIRY_BUFFER_MS) {
    // Still valid with comfortable margin.  No refresh needed.
    return oauth.accessToken
  }

  // Expired (or expiring within EXPIRY_BUFFER_MS, or missing the field
  // entirely — in which case we refresh pessimistically so the next
  // prompt has a known-fresh window).
  console.log(
    `[claude-refresh] token ${oauth.expiresAt
      ? "expires at " + new Date(oauth.expiresAt).toISOString()
      : "has no expiresAt"
    }; refreshing via ${REFRESH_URL}`,
  )

  const refreshed = await postRefresh(oauth.refreshToken)
  if (!refreshed) return null

  // Persist the refreshed token + refresh_token (Anthropic rotates the
  // refresh token too).  Atomic write so a partial write can't leave
  // the file corrupted.
  creds.claudeAiOauth = {
    ...oauth,
    accessToken: refreshed.access_token,
    refreshToken: refreshed.refresh_token,
    expiresAt: now + refreshed.expires_in * 1000,
  }
  try {
    writeAtomic(path, JSON.stringify(creds, null, 2))
  } catch (err) {
    console.warn(`[claude-refresh] write failed for ${path}:`, err)
    // We still got a valid token from the refresh, just couldn't persist.
    // Hand it back so this prompt succeeds; the NEXT call will see the
    // stale on-disk state and refresh again.
    return refreshed.access_token
  }

  console.log(
    `[claude-refresh] refreshed OK; new expiry ${new Date(now + refreshed.expires_in * 1000).toISOString()}`,
  )
  return refreshed.access_token
}

/**
 * POST to Anthropic's OAuth token endpoint with `grant_type=refresh_token`.
 * Returns the parsed response on success; null on any failure (logged).
 */
async function postRefresh(refreshToken: string): Promise<RefreshResponse | null> {
  let res: Response
  try {
    res = await fetch(REFRESH_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: CLIENT_ID,
      }),
    })
  } catch (err) {
    console.warn(
      `[claude-refresh] network error against ${REFRESH_URL}:`,
      err instanceof Error ? err.message : err,
    )
    return null
  }

  if (!res.ok) {
    // Common reasons:
    //   - 400 invalid_grant: refresh token expired or revoked Anthropic-side.
    //     User must re-auth on a Mac and re-upload.
    //   - 401 invalid_client: client_id wrong (Anthropic rotated it).
    //     Update CLAUDE_OAUTH_CLIENT_ID env to the new value.
    //   - 429: rate-limited; we don't retry inline.
    let body = ""
    try {
      body = (await res.text()).slice(0, 500)
    } catch {
      // ignore
    }
    console.warn(`[claude-refresh] refresh rejected: status=${res.status} body=${body}`)
    return null
  }

  try {
    const data = (await res.json()) as RefreshResponse
    if (
      typeof data.access_token !== "string" ||
      typeof data.refresh_token !== "string" ||
      typeof data.expires_in !== "number"
    ) {
      console.warn(`[claude-refresh] response missing required fields:`, Object.keys(data ?? {}))
      return null
    }
    return data
  } catch (err) {
    console.warn(`[claude-refresh] JSON parse on response failed:`, err)
    return null
  }
}

/**
 * tmpfile + rename atomic write.  Same pattern `writeCredentials` uses in
 * claude-credentials.ts — we duplicate the few lines here rather than
 * import to avoid a circular dependency through the same module's other
 * exports.  Mode 0600 so the tokens aren't world-readable on disk.
 */
function writeAtomic(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true })
  const tmp = path + ".tmp"
  writeFileSync(tmp, content, { mode: 0o600 })
  renameSync(tmp, path)
}

// ── Testing hooks ──────────────────────────────────────────────────────────

/** Exposed for tests only.  Resets module state so each test sees a clean slate. */
export function _resetInFlightForTest(): void {
  inFlight = null
}

/** Exposed for tests only.  Lets tests check the disk file's expiresAt. */
export function _readCredsForTest(): CredentialsFile | null {
  const path = credentialsPath()
  if (!existsSync(path)) return null
  try {
    return JSON.parse(readFileSync(path, "utf8")) as CredentialsFile
  } catch {
    return null
  }
}

/** Exposed for tests only.  Lets tests assert the file's mtime moved (or didn't). */
export function _statCredsForTest(): { mtimeMs: number; size: number } | null {
  const path = credentialsPath()
  if (!existsSync(path)) return null
  const s = statSync(path)
  return { mtimeMs: s.mtimeMs, size: s.size }
}
