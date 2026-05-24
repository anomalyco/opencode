/**
 * At-rest encryption helpers (ADR-0004).
 *
 * Wraps the GitHub OAuth access token in `collab_auth_session.github_access_token`
 * with AES-256-GCM under an HKDF-derived per-row key.  Anyone with a copy of
 * the SQLite file (or read access to the EFS mount, or an EFS snapshot) and
 * NO knowledge of `SESSION_SECRET` sees only ciphertext.
 *
 * Format:
 *
 *   enc:v1:<base64(salt(16B) || nonce(12B) || ciphertext || tag(16B))>
 *
 *   - The `enc:v1:` prefix lets `isEncrypted` cheaply distinguish encrypted
 *     rows from legacy plaintext on the migration's first boot.
 *   - The salt is random per row (not derived from the row's token) so that
 *     a row's ciphertext doesn't change identity if the column is ever
 *     re-keyed without a fresh OAuth.
 *   - AES-GCM gives authentication + integrity for free; a tampered byte
 *     fails the auth tag check on decrypt.
 *
 * The master key is HKDF-SHA-256(SESSION_SECRET, salt, info="collab.v1.token", 32).
 * The HKDF info string lets us evolve formats later (v2, etc.) without
 * accidentally producing the same key for two purposes.
 */

import { createCipheriv, createDecipheriv, hkdfSync, randomBytes, timingSafeEqual } from "crypto"

const PREFIX = "enc:v1:"
const SALT_LEN = 16
const NONCE_LEN = 12
const TAG_LEN = 16
const KEY_LEN = 32
const HKDF_INFO = "collab.v1.token"

const PLACEHOLDER_SECRETS = new Set([
  "",
  "dev-secret-change-me",
])

/**
 * Throws if the configured SESSION_SECRET is empty or a known placeholder.
 * Called once at boot from runCollabMigrations() / config load.  The
 * OPENCODE_ALLOW_UNAUTHENTICATED=1 local-dev escape hatch bypasses this
 * check (same flag that lets serve.ts start without a server password).
 */
export function assertUsableSessionSecret(secret: string): void {
  if (process.env["OPENCODE_ALLOW_UNAUTHENTICATED"] === "1") return
  if (PLACEHOLDER_SECRETS.has(secret)) {
    throw new Error(
      "SESSION_SECRET is empty or the dev placeholder. " +
        "Generate one with `openssl rand -hex 32` and set it in your environment, " +
        "or set OPENCODE_ALLOW_UNAUTHENTICATED=1 for local dev.",
    )
  }
}

export function isEncrypted(value: string): boolean {
  return typeof value === "string" && value.startsWith(PREFIX)
}

function deriveKey(secret: string, salt: Buffer): Buffer {
  // hkdfSync returns ArrayBuffer; wrap to Buffer so the cipher accepts it.
  const out = hkdfSync("sha256", Buffer.from(secret, "utf8"), salt, Buffer.from(HKDF_INFO, "utf8"), KEY_LEN)
  return Buffer.from(out)
}

/**
 * Encrypt a plaintext token.  Returns `enc:v1:...` ready to drop into the
 * `github_access_token` column.  Idempotent in the sense that calling
 * `encryptToken(encryptToken(plain))` is a programming error — guard at
 * the call site with `isEncrypted(...)`.
 */
export function encryptToken(plain: string, secret: string): string {
  const salt = randomBytes(SALT_LEN)
  const nonce = randomBytes(NONCE_LEN)
  const key = deriveKey(secret, salt)
  const cipher = createCipheriv("aes-256-gcm", key, nonce)
  const ciphertext = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()])
  const tag = cipher.getAuthTag()
  const payload = Buffer.concat([salt, nonce, ciphertext, tag])
  return PREFIX + payload.toString("base64")
}

/**
 * Decrypt an `enc:v1:...` value.  Returns null on any failure (wrong key,
 * tampered ciphertext, bad format).  Caller decides what to do — for the
 * auth-session table the policy is "treat as session not found, delete
 * the row defensively, WARN-log once".  See router.ts:getSession().
 */
export function decryptToken(value: string, secret: string): string | null {
  if (!isEncrypted(value)) return null
  const payload = Buffer.from(value.slice(PREFIX.length), "base64")
  if (payload.length < SALT_LEN + NONCE_LEN + TAG_LEN) return null
  const salt = payload.subarray(0, SALT_LEN)
  const nonce = payload.subarray(SALT_LEN, SALT_LEN + NONCE_LEN)
  const tag = payload.subarray(payload.length - TAG_LEN)
  const ciphertext = payload.subarray(SALT_LEN + NONCE_LEN, payload.length - TAG_LEN)
  try {
    const key = deriveKey(secret, Buffer.from(salt))
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(nonce))
    decipher.setAuthTag(Buffer.from(tag))
    const plain = Buffer.concat([decipher.update(ciphertext), decipher.final()])
    return plain.toString("utf8")
  } catch {
    return null
  }
}

/**
 * Used only by tests / migration sanity checks — constant-time compare two
 * encrypted blobs of identical length.  Not strictly required for the
 * runtime path but convenient when verifying re-encryption pairs.
 */
export function ciphertextEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  return timingSafeEqual(Buffer.from(a), Buffer.from(b))
}
