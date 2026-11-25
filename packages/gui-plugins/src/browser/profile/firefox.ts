import path from "node:path"
import type { CookieRead, ImportedCookie } from "./cookie"
import { snapshotDatabase, type SnapshotScratch } from "./database"
import type { CookieHost } from "./sites"

type Row = {
  host: string
  name: string
  value: string
  path: string
  expiry: number | bigint
  isSecure: number | bigint
  isHttpOnly: number | bigint
  sameSite: number | bigint
}

/**
 * Reads a Firefox-family profile's `cookies.sqlite`. Firefox stores values in plain text. Cookies of Multi-Account
 * Containers and private origins stay behind; the default container is the one the user browses in.
 */
export async function readFirefoxCookies(
  profile: string,
  scratch: SnapshotScratch,
  keep?: (host: string) => boolean,
): Promise<CookieRead> {
  const columns = "SELECT host, name, value, path, expiry, isSecure, isHttpOnly, sameSite FROM moz_cookies WHERE originAttributes = ''"

  const rows = await snapshotDatabase(path.join(profile, "cookies.sqlite"), scratch, (db) => {
    if (!keep)
      // SAFETY: the query names Firefox's moz_cookies columns, whose SQLite types match `Row`.
      return db.prepare(columns).all() as Row[]

    // Values are read only for the chosen hosts, a few hundred per statement, within SQLite's limit on parameters.
    const listed = db.prepare("SELECT DISTINCT host FROM moz_cookies WHERE originAttributes = '' AND typeof(host) = 'text'").all()
    // SAFETY: the query selects one column, and only rows where SQLite stores it as text.
    const hosts = (listed as { host: string }[]).flatMap((row) => (keep(row.host) ? [row.host] : []))

    return Array.from({ length: Math.ceil(hosts.length / 500) }, (_, index) => hosts.slice(index * 500, index * 500 + 500)).flatMap(
      (chunk) =>
        // SAFETY: as above, with the chosen hosts bound as parameters.
        db.prepare(`${columns} AND host IN (${chunk.map(() => "?").join(", ")})`).all(...chunk) as Row[],
    )
  })

  return { cookies: rows.map(fromRow), protected: 0, failed: 0 }
}

/** The hosts of a Firefox-family profile's cookies, for the list of its sites; no value is read. */
export async function readFirefoxHosts(profile: string, scratch: SnapshotScratch): Promise<CookieHost[]> {
  const rows = await snapshotDatabase(
    path.join(profile, "cookies.sqlite"),
    scratch,
    (db) =>
      // SAFETY: the query names Firefox's moz_cookies columns. SQLite types each value, so it keeps only rows whose host
      // is text; a damaged row names no site. The others are integers.
      db
        .prepare("SELECT host, expiry, lastAccessed FROM moz_cookies WHERE originAttributes = '' AND typeof(host) = 'text'")
        .all() as { host: string; expiry: number | bigint; lastAccessed: number | bigint }[],
  )

  // Firefox records the last access in microseconds.
  return rows.map((row) => ({ host: row.host, expires: expiry(row.expiry), used: Number(row.lastAccessed) / 1_000_000 }))
}

// Firefox 139 began storing milliseconds; earlier versions store seconds.
function expiry(value: number | bigint) {
  const number = Number(value)

  return number > 0 ? (number > 1e11 ? number / 1000 : number) : undefined
}

function fromRow(row: Row): ImportedCookie {
  const secure = !!Number(row.isSecure)
  const sameSite = Number(row.sameSite)

  return {
    host: row.host,
    name: row.name,
    value: row.value,
    path: row.path,
    secure,
    httpOnly: !!Number(row.isHttpOnly),
    expires: expiry(row.expiry),
    // 0 is both an explicit `SameSite=None` and an unset attribute; only a secure cookie can be sent as None.
    sameSite: sameSite === 1 ? "lax" : sameSite === 2 ? "strict" : secure ? "no_restriction" : "unspecified",
  }
}

/** The profiles a Firefox-family `profiles.ini` lists, with their directories resolved. */
export function firefoxProfiles(root: string, ini: string) {
  return ini.split(/^\[/m).flatMap((section) => {
    const header = section.slice(0, section.indexOf("]"))

    if (!header.startsWith("Profile")) return []

    const fields = Object.fromEntries(
      section
        .split(/\r?\n/)
        .slice(1)
        .flatMap((line) => {
          const index = line.indexOf("=")

          return index > 0 ? [[line.slice(0, index).trim(), line.slice(index + 1).trim()]] : []
        }),
    )

    const value = fields.Path

    if (!value) return []

    return [
      {
        id: value,
        name: fields.Name || value,
        directory: fields.IsRelative === "0" ? value : path.join(root, value),
      },
    ]
  })
}
