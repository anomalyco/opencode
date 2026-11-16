import path from "node:path"
import type { CookieRead, ImportedCookie } from "./cookie"
import { snapshotDatabase } from "./database"
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
export async function readFirefoxCookies(profile: string, keep?: (host: string) => boolean): Promise<CookieRead> {
  const rows = await snapshotDatabase(
    path.join(profile, "cookies.sqlite"),
    (db) =>
      // SAFETY: the query names Firefox's moz_cookies columns, whose SQLite types match `Row`.
      db
        .prepare(
          "SELECT host, name, value, path, expiry, isSecure, isHttpOnly, sameSite FROM moz_cookies WHERE originAttributes = ''",
        )
        .all() as Row[],
  )

  return { cookies: rows.filter((row) => !keep || keep(row.host)).map(fromRow), protected: 0, failed: 0 }
}

/** The hosts of a Firefox-family profile's cookies, for the list of its sites; no value is read. */
export async function readFirefoxHosts(profile: string): Promise<CookieHost[]> {
  const rows = await snapshotDatabase(
    path.join(profile, "cookies.sqlite"),
    (db) =>
      // SAFETY: the query names Firefox's moz_cookies columns, whose SQLite types match the row.
      db
        .prepare("SELECT host, expiry, lastAccessed FROM moz_cookies WHERE originAttributes = ''")
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
