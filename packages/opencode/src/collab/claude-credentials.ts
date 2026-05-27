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

/** Canonical EFS path for the credentials file.  Override via env for tests. */
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
 * Ensure the canonical plugin path is a symlink to the EFS file.  Idempotent:
 *
 *   - If already symlinked correctly → no-op.
 *   - If a stale symlink points elsewhere → repoint.
 *   - If a regular file exists (e.g. local docker-compose bind-mount) → leave
 *     it alone.  Local dev runs the bind-mount path; we must not clobber it.
 *   - If absent → create the directory + symlink.
 *
 * Called by writeCredentials so the very first UI upload makes the file
 * visible to the plugin without requiring a container restart.  Also a
 * defence-in-depth backstop if scripts/entrypoint.sh's setup missed (e.g.
 * unrecognised env-var combinations).
 */
function ensureCanonicalSymlink(): void {
  const target = credentialsPath()
  const canonical = canonicalPluginPath()
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
      // Regular file (local docker-compose bind-mount) — DO NOT TOUCH.
      // The bind-mount provides credentials directly from the host.
      return
    }
    symlinkSync(target, canonical)
  } catch (err) {
    console.warn("[collab.claude-creds] failed to ensure canonical symlink:", err)
  }
}

export interface CredentialsStatus {
  /** True iff a credentials file exists and parses as JSON with at least the
   *  fields opencode-claude-auth expects (`access_token`, `refresh_token`). */
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

export function getCredentialsStatus(): CredentialsStatus {
  const path = credentialsPath()
  if (!existsSync(path)) return { present: false }
  try {
    const stat = statSync(path)
    if (!stat.isFile() || stat.size === 0) return { present: false, bytes: stat.size }
    const raw = readFileSync(path, "utf8")
    const parsed = JSON.parse(raw) as { access_token?: string; refresh_token?: string; email?: string }
    const valid = typeof parsed.access_token === "string" && typeof parsed.refresh_token === "string"
    if (!valid) return { present: false, mtime: stat.mtimeMs, bytes: stat.size }
    return {
      present: true,
      email: typeof parsed.email === "string" ? parsed.email : undefined,
      mtime: stat.mtimeMs,
      bytes: stat.size,
    }
  } catch (err) {
    console.warn("[collab.claude-creds] status read failed:", err)
    return { present: false }
  }
}

/**
 * Atomically write a fresh credentials JSON to the EFS path.  Validates the
 * payload parses + has the two fields the plugin needs.  Returns true on
 * success; throws on any validation failure so the caller can surface the
 * specific reason to the uploader.
 *
 * Auditing: the caller is expected to log who uploaded + how big the file
 * was.  We intentionally do NOT log the file content.
 */
export function writeCredentials(jsonString: string): { email?: string; bytes: number } {
  let parsed: { access_token?: unknown; refresh_token?: unknown; email?: unknown }
  try {
    parsed = JSON.parse(jsonString) as typeof parsed
  } catch (err) {
    throw new Error(
      "Could not parse credentials as JSON.  Paste the full file contents from " +
        "`security find-generic-password -s \"Claude Code-credentials\" -w` (Mac) " +
        "or the equivalent on your machine.",
    )
  }
  if (typeof parsed.access_token !== "string" || parsed.access_token.length < 8) {
    throw new Error("JSON parsed but no `access_token` field — this doesn't look like a Claude credentials file.")
  }
  if (typeof parsed.refresh_token !== "string" || parsed.refresh_token.length < 8) {
    throw new Error("JSON parsed but no `refresh_token` field — credentials would expire on first use.")
  }
  // Hard cap so a runaway paste can't fill the disk.  Real files are a few KB.
  if (jsonString.length > 64 * 1024) {
    throw new Error("Credentials payload exceeds 64 KB — refusing to write.")
  }

  const path = credentialsPath()
  mkdirSync(dirname(path), { recursive: true })
  const tmp = path + ".tmp"
  writeFileSync(tmp, jsonString, { mode: 0o600 })
  renameSync(tmp, path) // atomic on the same filesystem

  // Make the file immediately visible to the opencode-claude-auth plugin by
  // ensuring ~/.claude/.credentials.json is a symlink to this EFS path.
  // Without this, a UI-only bootstrap (no Secrets Manager seed) leaves the
  // plugin's canonical read path absent on the FIRST upload — the user
  // would have to wait for the next container restart for entrypoint.sh
  // to set up the symlink.
  ensureCanonicalSymlink()

  return {
    email: typeof parsed.email === "string" ? parsed.email : undefined,
    bytes: jsonString.length,
  }
}
