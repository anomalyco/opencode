import fs from "node:fs/promises"
import path from "node:path"
import os from "node:os"
import crypto from "node:crypto"

/**
 * Compute the default directory we keep `install_id` in.
 *
 * Per design risk R-5 we deliberately use the **cache** directory, not the
 * config directory: cloud-sync tools (Dropbox / OneDrive / iCloud) often sync
 * `~/.config/` but skip `~/.cache/`, and we don't want the same install_id
 * appearing on multiple machines.
 *
 * For simplicity we use `~/.cache/opencode/` on every platform. Windows users
 * end up with `%USERPROFILE%\.cache\opencode\install_id` — slightly non-native
 * but consistent and easy to reason about. (Documented in README.)
 */
export function defaultInstallIdDir(): string {
  // Allow OPENCODE_TEST_HOME to override $HOME for test isolation, mirroring
  // the convention used in packages/opencode/src/global/index.ts.
  const home = process.env.OPENCODE_TEST_HOME || os.homedir()
  return path.join(home, ".cache", "opencode")
}

export function defaultInstallIdPath(): string {
  return path.join(defaultInstallIdDir(), "install_id")
}

/** UUIDv4. We could use Bun's `crypto.randomUUID` but `node:crypto` works in Bun too. */
function generateUuidV4(): string {
  return crypto.randomUUID()
}

/** A regexp matching a canonical lowercase UUIDv4. */
const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function isValidUuid(s: string): boolean {
  return UUID_V4_RE.test(s.trim())
}

/**
 * Read the install_id, lazily creating it on first call.
 *
 * - First read: generate UUIDv4, write to file with mode 0600, return.
 * - Subsequent reads: return the cached value.
 * - Corrupted file (not a UUID): regenerate.
 *
 * Errors during persistence are swallowed: we still return a UUID so callers
 * can proceed. (Telemetry must never break the host process.)
 */
export async function getInstallId(opts?: { dir?: string }): Promise<string> {
  const dir = opts?.dir ?? defaultInstallIdDir()
  const file = path.join(dir, "install_id")

  // Try to read existing.
  try {
    const raw = await fs.readFile(file, "utf8")
    const trimmed = raw.trim()
    if (isValidUuid(trimmed)) {
      return trimmed
    }
    // Fall through to regenerate.
  } catch {
    // ENOENT or similar — create.
  }

  const id = generateUuidV4()

  try {
    await fs.mkdir(dir, { recursive: true })
    // Write with 0600 perms. On win32 chmod is a near no-op but the call
    // doesn't error, so we just always pass mode and let the OS do what it does.
    await fs.writeFile(file, id + "\n", { mode: 0o600, encoding: "utf8" })
    // Belt-and-suspenders: chmod again in case `writeFile` ignored the mode
    // (some platforms / older Node versions do).
    if (process.platform !== "win32") {
      try {
        await fs.chmod(file, 0o600)
      } catch {
        // ignore
      }
    }
  } catch {
    // Couldn't persist; that's OK — we still return the in-memory UUID for this run.
  }

  return id
}
