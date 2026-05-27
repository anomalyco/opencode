/**
 * Claude credentials lifecycle helpers.
 *
 * The container's Claude auth file lives on EFS (so plugin token-refresh
 * survives ECS task replacement) at:
 *
 *   /home/opencode/.local/share/opencode/claude-credentials.json
 *
 * `~/.claude/.credentials.json` is a symlink to that path (set up by
 * scripts/entrypoint.sh).  The opencode-claude-auth plugin reads/writes
 * either path interchangeably — we operate on the EFS path here so we
 * don't depend on the symlink existing.
 *
 * Endpoints (router.ts):
 *   GET  /collab/claude-creds/status   — non-sensitive shape only (presence
 *                                         + last-modified, never tokens)
 *   POST /collab/claude-creds          — any authenticated org member can
 *                                         upload a fresh credentials JSON
 *                                         (process-wide; whoever uploads
 *                                         last wins until someone else
 *                                         overwrites).
 *
 * Why process-wide vs per-session: the opencode-claude-auth plugin runs once
 * per container process and serves every native session.  Making it
 * session-aware would require either spawning one opencode process per
 * collab session (huge re-arch) or forking the plugin (loses upstream
 * sync).  Process-wide is the realistic model.
 */

import { existsSync, lstatSync, mkdirSync, renameSync, statSync, symlinkSync, unlinkSync, writeFileSync, readFileSync } from "fs"
import { dirname, join } from "path"
import { homedir } from "os"

/**
 * Where credentials get atomic-written.  scripts/entrypoint.sh probes EFS
 * writability at boot and exports CLAUDE_CREDENTIALS_PATH pointing at
 * either the EFS path (persistent) or the local canonical path (fallback
 * when EFS isn't writable from uid 10001 — ADR-0003 access-point migration
 * pending).  Either way the opencode-claude-auth plugin reads the canonical
 * path and gets the right bytes.
 *
 * Tests can override via env.
 */
export function credentialsPath(): string {
  if (process.env["CLAUDE_CREDENTIALS_PATH"]) return process.env["CLAUDE_CREDENTIALS_PATH"]
  return join(
    process.env["HOME"] ?? homedir() ?? "/home/opencode",
    ".local",
    "share",
    "opencode",
    "claude-credentials.json",
  )
}

/**
 * Canonical path the opencode-claude-auth plugin reads at runtime —
 * `~/.claude/.credentials.json`.  We symlink this to the EFS path
 * (`credentialsPath()`) so the plugin's reads + refresh-writes both
 * land on EFS, surviving container replacement.
 */
function canonicalPluginPath(): string {
  return join(process.env["HOME"] ?? homedir() ?? "/home/opencode", ".claude", ".credentials.json")
}

/**
 * Ensure the canonical plugin path is a symlink to the storage file.
 *
 *   - **EFS-fallback mode** (credentialsPath() === canonicalPluginPath()):
 *     `writeCredentials` wrote DIRECTLY to the canonical path, so no
 *     symlink is needed.  Early-return.
 *   - **Persistent mode** (credentialsPath() !== canonicalPluginPath()):
 *       - Already-correct symlink → repoint (cheap; saves a readlink).
 *       - Regular file (local docker-compose bind-mount, or a prior
 *         entrypoint local-fallback seed) → leave alone.
 *       - Absent → create the directory + symlink.
 *
 * Called by writeCredentials so the first UI upload is immediately visible
 * to the plugin without a container restart.  Also a defence-in-depth
 * backstop for any path the entrypoint missed.
 */
function ensureCanonicalSymlink(): void {
  const target = credentialsPath()
  const canonical = canonicalPluginPath()

  // Self-link guard: when the entrypoint detected EFS as unwritable it
  // pointed CLAUDE_CREDENTIALS_PATH at the canonical path itself.  Writing
  // already happened at canonical — no symlink work to do.
  if (target === canonical) return

  try {
    mkdirSync(dirname(canonical), { recursive: true })
    let existing: ReturnType<typeof lstatSync> | null = null
    try {
      existing = lstatSync(canonical)
    } catch {
      // ENOENT → nothing exists, fall through to symlink creation
    }
    if (existing?.isSymbolicLink()) {
      // Repoint only if the current symlink target is wrong.
      // (Read via fs.readlink would tell us; cheapest path is just to
      // unlink + relink — saves an extra syscall and is idempotent.)
      unlinkSync(canonical)
    } else if (existing?.isFile()) {
      // Regular file (local docker-compose bind-mount, OR the entrypoint's
      // local-fallback seed when EFS is unwritable) — DO NOT TOUCH.
      return
    }
    symlinkSync(target, canonical)
  } catch (err) {
    console.warn("[collab.claude-creds] failed to ensure canonical symlink:", err)
  }
}

export interface CredentialsStatus {
  /** True iff a credentials file exists and parses as one of the accepted
   *  Claude credentials shapes (see `normalizeClaudeCreds`). */
  readonly present: boolean
  /** Logged-in account email, when the file carries one.  Useful breadcrumb
   *  for operators choosing whether to overwrite. */
  readonly email?: string
  /** Last on-disk mtime (epoch ms) — surfaces "refreshed N minutes ago" in
   *  the UI without leaking actual tokens. */
  readonly mtime?: number
  /** Raw size in bytes, for "file looks empty" debugging. */
  readonly bytes?: number
}

interface NormalizedCreds {
  /** OAuth bearer token used in `Authorization: Bearer <accessToken>`. */
  readonly accessToken: string
  /** OAuth refresh token; written back when the plugin refreshes. */
  readonly refreshToken: string
  /** Optional account email — pulled from any of the accepted shapes. */
  readonly email?: string
  /** True iff input was the Mac keychain nested shape (so `writeCredentials`
   *  can preserve the full payload — `mcpOAuth`, `expiresAt`, `scopes`,
   *  `subscriptionType`, etc.). */
  readonly wasKeychainShape: boolean
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x)
}

/**
 * Recognise a Claude credentials payload in any of three shapes the user
 * might paste from `security find-generic-password -s "Claude Code-credentials" -w`:
 *
 *   1. Mac keychain nested shape (full dump):
 *        `{ "claudeAiOauth": { "accessToken": "...", "refreshToken": "...", ...},
 *           "mcpOAuth": {...} }`
 *      The plugin proves it accepts this shape (it's what the entrypoint
 *      seeds from `CLAUDE_CREDENTIALS_JSON` env, and the plugin loads
 *      successfully).  Preserve as-is.
 *
 *   2. Flat camelCase:
 *        `{ "accessToken": "...", "refreshToken": "..." }`
 *      Equivalent to (1) with the wrapping unwrapped.  Will be re-wrapped
 *      in keychain shape for on-disk storage.
 *
 *   3. Flat snake_case (legacy / OAuth-spec):
 *        `{ "access_token": "...", "refresh_token": "..." }`
 *      Accepted for backwards compatibility; will also be re-wrapped.
 *
 * Returns `null` when none of the three shapes match — caller throws a
 * descriptive error that names all three.
 */
function normalizeClaudeCreds(input: unknown): NormalizedCreds | null {
  if (!isRecord(input)) return null

  // Shape 1: Mac keychain nested.
  if (isRecord(input.claudeAiOauth)) {
    const inner = input.claudeAiOauth
    if (typeof inner.accessToken === "string" && typeof inner.refreshToken === "string") {
      return {
        accessToken: inner.accessToken,
        refreshToken: inner.refreshToken,
        email: typeof inner.email === "string" ? inner.email : undefined,
        wasKeychainShape: true,
      }
    }
  }

  // Shape 2: flat camelCase.
  if (typeof input.accessToken === "string" && typeof input.refreshToken === "string") {
    return {
      accessToken: input.accessToken,
      refreshToken: input.refreshToken,
      email: typeof input.email === "string" ? input.email : undefined,
      wasKeychainShape: false,
    }
  }

  // Shape 3: flat snake_case.
  if (typeof input.access_token === "string" && typeof input.refresh_token === "string") {
    return {
      accessToken: input.access_token,
      refreshToken: input.refresh_token,
      email: typeof input.email === "string" ? input.email : undefined,
      wasKeychainShape: false,
    }
  }

  return null
}

/** Exported for testing only. */
export const _normalizeClaudeCredsForTest = normalizeClaudeCreds

export function getCredentialsStatus(): CredentialsStatus {
  const path = credentialsPath()
  if (!existsSync(path)) return { present: false }
  try {
    const stat = statSync(path)
    if (!stat.isFile() || stat.size === 0) return { present: false, bytes: stat.size }
    const raw = readFileSync(path, "utf8")
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      return { present: false, mtime: stat.mtimeMs, bytes: stat.size }
    }
    const normalized = normalizeClaudeCreds(parsed)
    if (!normalized) return { present: false, mtime: stat.mtimeMs, bytes: stat.size }
    return {
      present: true,
      email: normalized.email,
      mtime: stat.mtimeMs,
      bytes: stat.size,
    }
  } catch (err) {
    console.warn("[collab.claude-creds] status read failed:", err)
    return { present: false }
  }
}

/**
 * Atomically write a fresh credentials JSON to the EFS path.
 *
 * Accepts any of three shapes — see `normalizeClaudeCreds` for the matrix.
 * Throws on any validation failure so the caller can surface the specific
 * reason to the uploader.
 *
 * On-disk format is always the Mac keychain nested shape
 * (`{claudeAiOauth: {...}}`) because that's what the upstream
 * `opencode-claude-auth` plugin proves it accepts (the entrypoint's
 * env-seed path uses this shape and the plugin loads it successfully).
 *
 *   - Keychain input → written as-is (preserves `mcpOAuth`, `expiresAt`,
 *     `scopes`, `subscriptionType`, etc.).
 *   - Flat input → wrapped minimally into `{claudeAiOauth: {accessToken,
 *     refreshToken}}`.
 *
 * Auditing: the caller is expected to log who uploaded + how big the file
 * was.  We intentionally do NOT log the file content.
 */
export function writeCredentials(jsonString: string): { email?: string; bytes: number } {
  // Hard cap so a runaway paste can't fill the disk.  Real files are a few KB.
  if (jsonString.length > 64 * 1024) {
    throw new Error("Credentials payload exceeds 64 KB — refusing to write.")
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(jsonString)
  } catch (err) {
    throw new Error(
      "Could not parse credentials as JSON.  Paste the output from one of:\n" +
        "  - Mac:   security find-generic-password -s \"Claude Code-credentials\" -w\n" +
        "  - Linux: cat ~/.claude/.credentials.json",
    )
  }

  const normalized = normalizeClaudeCreds(parsed)
  if (!normalized) {
    throw new Error(
      "JSON parsed but it doesn't look like a Claude credentials file.  Accepted shapes:\n" +
        "  - Mac keychain dump: {\"claudeAiOauth\": {\"accessToken\": \"sk-ant-...\", \"refreshToken\": \"sk-ant-...\", ...}}\n" +
        "  - Flat camelCase:    {\"accessToken\": \"sk-ant-...\", \"refreshToken\": \"sk-ant-...\"}\n" +
        "  - Flat snake_case:   {\"access_token\": \"sk-ant-...\", \"refresh_token\": \"sk-ant-...\"}",
    )
  }
  if (normalized.accessToken.length < 8) {
    throw new Error("`accessToken` is too short to be a valid Claude credential.")
  }
  if (normalized.refreshToken.length < 8) {
    throw new Error("`refreshToken` is too short — credentials would expire on first use.")
  }

  // Compute the on-disk payload:
  //   - Keychain input → write the original JSON unchanged so `mcpOAuth`,
  //     `expiresAt`, `scopes`, `subscriptionType`, `rateLimitTier`, etc.
  //     are all preserved.
  //   - Flat input → wrap minimally.
  const onDiskString = normalized.wasKeychainShape
    ? jsonString
    : JSON.stringify({
        claudeAiOauth: {
          accessToken: normalized.accessToken,
          refreshToken: normalized.refreshToken,
          ...(normalized.email ? { email: normalized.email } : {}),
        },
      })

  const path = credentialsPath()
  mkdirSync(dirname(path), { recursive: true })
  const tmp = path + ".tmp"
  writeFileSync(tmp, onDiskString, { mode: 0o600 })
  renameSync(tmp, path) // atomic on the same filesystem

  // Make the file immediately visible to the opencode-claude-auth plugin by
  // ensuring ~/.claude/.credentials.json is a symlink to this EFS path.
  // Without this, a UI-only bootstrap (no Secrets Manager seed) leaves the
  // plugin's canonical read path absent on the FIRST upload — the user
  // would have to wait for the next container restart for entrypoint.sh
  // to set up the symlink.
  ensureCanonicalSymlink()

  return {
    email: normalized.email,
    bytes: onDiskString.length,
  }
}
