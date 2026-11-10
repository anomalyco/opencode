import { Option, Schema } from "effect"

/** A cookie read from another browser or a cookie file, before it is written into the profile. */
export type ImportedCookie = {
  /** As browsers store it: `.github.com` for a domain cookie, `github.com` for a host-only one. */
  readonly host: string
  readonly name: string
  readonly value: string
  readonly path: string
  readonly secure: boolean
  readonly httpOnly: boolean
  /** Unix seconds; undefined for a session cookie. */
  readonly expires: number | undefined
  readonly sameSite: "unspecified" | "no_restriction" | "lax" | "strict"
}

/** What an import found: cookies it can write, and how many it could not read. */
export type CookieRead = {
  readonly cookies: readonly ImportedCookie[]
  /** Values the source encrypts with a key only that browser holds, such as Chrome's app-bound encryption. */
  readonly protected: number
  /** Values that failed to decrypt or parse. */
  readonly failed: number
}

/** Seconds between 1601-01-01 (Chromium's and Windows' epoch) and 1970-01-01. */
const WINDOWS_EPOCH_OFFSET = 11_644_473_600

/** A Chromium timestamp (microseconds since 1601) as Unix seconds; undefined for 0, which means none. */
export function chromiumTime(value: number | bigint) {
  const micros = Number(value)

  if (!micros) return undefined

  return micros / 1_000_000 - WINDOWS_EPOCH_OFFSET
}

/**
 * The details Electron's `cookies.set` takes. Undefined for a cookie no browser would send again: expired, nameless
 * and empty, or with no host.
 */
export function cookieDetails(cookie: ImportedCookie, now = Date.now() / 1000) {
  const host = cookie.host.replace(/^\./, "")

  if (!host || (!cookie.name && !cookie.value)) return undefined

  if (cookie.expires !== undefined && cookie.expires <= now) return undefined
  const path = cookie.path.startsWith("/") ? cookie.path : "/"
  const bracketed = host.includes(":") && !host.startsWith("[") ? `[${host}]` : host
  // A host-only cookie takes its host from the URL; `__Host-` cookies must stay host-only.
  const domain = cookie.host.startsWith(".") && !cookie.name.startsWith("__Host-") ? cookie.host : undefined

  const details: Electron.CookiesSetDetails = {
    url: `${cookie.secure ? "https" : "http"}://${bracketed}${path}`,
    name: cookie.name,
    value: cookie.value,
    path,
    secure: cookie.secure,
    httpOnly: cookie.httpOnly,
    sameSite: cookie.sameSite,
  }

  if (domain) details.domain = domain

  if (cookie.expires !== undefined) details.expirationDate = cookie.expires

  return details
}

const JsonCookie = Schema.Struct({
  domain: Schema.String,
  name: Schema.String,
  value: Schema.String,
  path: Schema.optional(Schema.String),
  secure: Schema.optional(Schema.Boolean),
  httpOnly: Schema.optional(Schema.Boolean),
  hostOnly: Schema.optional(Schema.Boolean),
  session: Schema.optional(Schema.Boolean),
  /** Chrome's cookies API and the extensions that export it: Unix seconds. */
  expirationDate: Schema.optional(Schema.Number),
  /** Playwright's storage state: Unix seconds, -1 for a session cookie. */
  expires: Schema.optional(Schema.Number),
  sameSite: Schema.optional(Schema.NullOr(Schema.String)),
})

const JsonCookies = Schema.Union([Schema.Array(JsonCookie), Schema.Struct({ cookies: Schema.Array(JsonCookie) })])

const decodeJson = Schema.decodeUnknownOption(Schema.fromJsonString(JsonCookies))

/**
 * Reads an exported cookie file: a JSON array as Chrome's cookies API, Cookie-Editor and EditThisCookie export it, a
 * Playwright storage state, or a Netscape `cookies.txt`. Undefined when the text is neither.
 */
export function parseCookieFile(text: string): CookieRead | undefined {
  const json = decodeJson(text.trim())

  if (Option.isSome(json)) {
    const list = "cookies" in json.value ? json.value.cookies : json.value

    return { cookies: list.map(fromJson), protected: 0, failed: 0 }
  }

  const lines = text.split(/\r?\n/)
  const rows = lines.flatMap((line) => netscapeRow(line))
  const failed = rows.filter((row) => row === undefined).length
  const cookies = rows.filter((row) => row !== undefined)

  if (cookies.length === 0) return undefined

  return { cookies, protected: 0, failed }
}

function fromJson(cookie: typeof JsonCookie.Type): ImportedCookie {
  const seconds =
    cookie.expirationDate ?? (cookie.expires !== undefined && cookie.expires > 0 ? cookie.expires : undefined)

  return {
    host: jsonHost(cookie),
    name: cookie.name,
    value: cookie.value,
    path: cookie.path ?? "/",
    secure: cookie.secure ?? false,
    httpOnly: cookie.httpOnly ?? false,
    expires: cookie.session ? undefined : seconds,
    sameSite: sameSite(cookie.sameSite),
  }
}

// Chrome's API marks a host-only cookie with `hostOnly`; files without it keep the domain as written.
function jsonHost(cookie: typeof JsonCookie.Type) {
  const bare = cookie.domain.replace(/^\./, "")

  if (cookie.hostOnly === true) return bare

  if (cookie.hostOnly === false) return `.${bare}`

  return cookie.domain
}

function sameSite(value: string | null | undefined): ImportedCookie["sameSite"] {
  const lower = value?.toLowerCase()

  if (lower === "lax") return "lax"

  if (lower === "strict") return "strict"

  if (lower === "none" || lower === "no_restriction") return "no_restriction"

  return "unspecified"
}

/** One line of a Netscape cookie file: nothing for a comment or a blank line, undefined for one it cannot read. */
function netscapeRow(line: string): (ImportedCookie | undefined)[] {
  const httpOnly = line.startsWith("#HttpOnly_")
  const body = httpOnly ? line.slice("#HttpOnly_".length) : line

  if (!body.trim() || body.startsWith("#")) return []
  const fields = body.split("\t")

  if (fields.length < 7) return [undefined]
  const [domain = "", subdomains, path = "/", secure, expiry, name = "", ...value] = fields
  const seconds = Number(expiry)
  const bare = domain.replace(/^\./, "")

  return [
    {
      host: subdomains === "TRUE" ? `.${bare}` : bare,
      name,
      value: value.join("\t"),
      path,
      secure: secure === "TRUE",
      httpOnly,
      expires: Number.isFinite(seconds) && seconds > 0 ? seconds : undefined,
      sameSite: "unspecified",
    },
  ]
}

/**
 * Chromium's own user agent for this version: without the app's and Electron's product tokens, which sign-in pages
 * such as Google's refuse as an embedded browser.
 */
export function browserUserAgent(agent: string) {
  return agent.replace(/ (?!(?:AppleWebKit|Chrome|Safari|Mobile|Version)\/)[^\s()/]+\/\S+/g, "")
}
