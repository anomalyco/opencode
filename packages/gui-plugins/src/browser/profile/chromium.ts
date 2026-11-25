import { createDecipheriv, createHash, pbkdf2Sync } from "node:crypto"
import { chromiumTime, type CookieRead, type ImportedCookie } from "./cookie"
import { snapshotDatabase, type SnapshotScratch } from "./database"
import type { CookieHost } from "./sites"

/**
 * The key a Chromium profile encrypts cookie values with.
 * - `gcm`: Windows. AES-256-GCM, unwrapped from `Local State` with DPAPI.
 * - `cbc`: macOS and Linux. AES-128-CBC keys derived from the Safe Storage password; `v11` only where a keyring holds one.
 */
export type ChromiumKey =
  | { readonly type: "gcm"; readonly key: Uint8Array }
  | { readonly type: "cbc"; readonly v10: Uint8Array; readonly v11: Uint8Array | undefined }

/** A Chromium cookie value: decrypted text, or why it has none. */
export type Decrypted = { readonly value: string } | { readonly error: "protected" | "failed" }

/** The AES-128 key Chromium derives from a Safe Storage password: 1003 PBKDF2 rounds on macOS, 1 on Linux. */
export function deriveCbcKey(password: string, iterations: number) {
  return pbkdf2Sync(password, "saltysalt", iterations, 16, "sha1")
}

/**
 * Decrypts one `encrypted_value`. Since cookie database version 24 the plain text starts with the SHA-256 of the
 * cookie's host, which this strips. `v20` values use Chrome's app-bound encryption on Windows, which only the browser's
 * own elevation service can unwrap.
 */
export function decryptChromium(encrypted: Uint8Array, key: ChromiumKey, host: string): Decrypted {
  const buffer = Buffer.from(encrypted)
  const version = buffer.subarray(0, 3).toString("latin1")

  if (version === "v20") return { error: "protected" }

  // A GCM value carries a 12-byte nonce and a 16-byte tag around its text.
  if ((version !== "v10" && version !== "v11") || (key.type === "gcm" && buffer.length < 3 + 12 + 16))
    return { error: "failed" }
  const bytes = attempt(() => decipher(buffer, version, key))

  if (!bytes) return { error: "failed" }
  const digest = createHash("sha256").update(host).digest()
  const text = bytes.length >= 32 && bytes.subarray(0, 32).equals(digest) ? bytes.subarray(32) : bytes
  const value = attempt(() => new TextDecoder("utf-8", { fatal: true }).decode(text))

  return value === undefined ? { error: "failed" } : { value }
}

function decipher(buffer: Buffer, version: "v10" | "v11", key: ChromiumKey) {
  if (key.type === "gcm") {
    const nonce = buffer.subarray(3, 15)
    const body = buffer.subarray(15, -16)
    const gcm = createDecipheriv("aes-256-gcm", key.key, nonce)
    gcm.setAuthTag(buffer.subarray(-16))

    return Buffer.concat([gcm.update(body), gcm.final()])
  }

  const secret = version === "v11" ? key.v11 : key.v10

  if (!secret) throw new Error("No key for this cookie version")
  const cbc = createDecipheriv("aes-128-cbc", secret, Buffer.alloc(16, 0x20))

  return Buffer.concat([cbc.update(buffer.subarray(3)), cbc.final()])
}

// A wrong key or a corrupt value throws from the decipher or the UTF-8 decoder, which have no non-throwing form;
// either is one failed cookie.
function attempt<T>(run: () => T) {
  try {
    return run()
  } catch {
    return undefined
  }
}

/** A cookie row whose every value has the type Chromium writes; a damaged row has another, which SQLite allows. */
const WELL_FORMED = [
  "typeof(host_key) = 'text'",
  "typeof(name) = 'text'",
  "typeof(value) = 'text'",
  "typeof(encrypted_value) = 'blob'",
  "typeof(path) = 'text'",
  ...["expires_utc", "has_expires", "is_secure", "is_httponly", "samesite"].map((column) => `typeof(${column}) = 'integer'`),
  "typeof(top_frame_site_key) IN ('text', 'null')",
].join(" AND ")

/** Chromium's `samesite` column, by value; -1 is unspecified. */
const SAME_SITE = ["no_restriction", "lax", "strict"] as const

type Row = {
  host_key: string
  name: string
  value: string
  encrypted_value: Uint8Array
  path: string
  expires_utc: number | bigint
  has_expires: number | bigint
  is_secure: number | bigint
  is_httponly: number | bigint
  samesite: number | bigint
  top_frame_site_key: string | null
}

/**
 * The hosts of a Chromium profile's cookies that an import would write, for the list of its sites. It reads the
 * plain-text columns only: no value is read, so nothing is decrypted and no key is asked for. Partitioned cookies
 * stay out, as an import leaves them behind.
 */
export async function readChromiumHosts(database: string, scratch: SnapshotScratch): Promise<CookieHost[]> {
  const rows = await snapshotDatabase(database, scratch, (db) => {
    const query = db.prepare(
      "SELECT host_key, expires_utc, has_expires, last_access_utc FROM cookies WHERE (top_frame_site_key IS NULL OR top_frame_site_key = '') AND typeof(host_key) = 'text'",
    )

    query.setReadBigInts(true)

    // SAFETY: the query names Chromium's cookie table columns. SQLite types each value, so it keeps only rows whose
    // host is text; a damaged row names no site. The rest are integers.
    return query.all() as { host_key: string; expires_utc: bigint; has_expires: bigint; last_access_utc: bigint }[]
  })

  return rows.map((row) => ({
    host: row.host_key,
    expires: Number(row.has_expires) ? chromiumTime(row.expires_utc) : undefined,
    used: chromiumTime(row.last_access_utc) ?? 0,
  }))
}

/**
 * Reads a Chromium profile's cookie database from a copy, so the running browser keeps its lock. Partitioned cookies
 * (CHIPS) stay behind: Electron cannot write a cookie's partition. With `keep`, only the rows of the hosts it keeps
 * are decrypted and counted; the others are not read further.
 */
export async function readChromiumCookies(
  database: string,
  key: ChromiumKey,
  scratch: SnapshotScratch,
  keep?: (host: string) => boolean,
): Promise<CookieRead> {
  const read = await snapshotDatabase(database, scratch, (db) => {
    const query = db.prepare(
      `SELECT host_key, name, value, encrypted_value, path, expires_utc, has_expires, is_secure, is_httponly, samesite, top_frame_site_key FROM cookies WHERE ${WELL_FORMED}`,
    )

    // Damaged rows, by host where it is text, so an import of chosen sites counts only theirs.
    const damaged = db.prepare(`SELECT CASE WHEN typeof(host_key) = 'text' THEN host_key END AS host FROM cookies WHERE NOT (${WELL_FORMED})`)

    // Chromium's timestamps count microseconds since 1601, past the largest integer a number holds exactly.
    query.setReadBigInts(true)

    // SAFETY: the query names Chromium's cookie table columns and keeps only the rows whose values have the SQLite
    // types `Row` says; the second one's `host` is text or null.
    return { rows: query.all() as Row[], damaged: damaged.all() as { host: string | null }[] }
  })

  // A damaged row is one cookie that does not import, as one whose value does not decrypt; one whose host is not text
  // names no site, so only an import of every site counts it.
  const failed = read.damaged.filter((row) => (row.host === null ? !keep : !keep || keep(row.host))).length

  return read.rows.reduce<{ cookies: ImportedCookie[]; protected: number; failed: number; skipped: number }>(
    (result, row) => {
      if (keep && !keep(row.host_key)) return result

      if (row.top_frame_site_key) {
        result.skipped++

        return result
      }

      const decrypted = rowValue(row, key)

      if ("error" in decrypted) {
        result[decrypted.error]++

        return result
      }

      result.cookies.push({
        host: row.host_key,
        name: row.name,
        value: decrypted.value,
        path: row.path,
        secure: !!Number(row.is_secure),
        httpOnly: !!Number(row.is_httponly),
        expires: Number(row.has_expires) ? chromiumTime(row.expires_utc) : undefined,
        sameSite: SAME_SITE[Number(row.samesite)] ?? "unspecified",
      })

      return result
    },
    { cookies: [], protected: 0, failed, skipped: 0 },
  )
}

function rowValue(row: Row, key: ChromiumKey): Decrypted {
  if (row.value || !row.encrypted_value.length) return { value: row.value }

  return decryptChromium(row.encrypted_value, key, row.host_key)
}
