/**
 * WWW-Authenticate header parser per RFC 9110 Section 11.6.1.
 *
 * Implements the full grammar from RFC 7235 §2.1 and RFC 9110 §11.6.1:
 *   WWW-Authenticate = 1#challenge
 *   challenge        = auth-scheme [ 1*SP ( token68 / #auth-param ) ]
 *   auth-param       = token BWS "=" BWS ( token / quoted-string )
 *   token68          = 1*( ALPHA / DIGIT / "-" / "." / "_" / "~" / "+" / "/" ) *"="
 *
 * Key RFC compliance points:
 * - RFC 9110 §5.6.2: token character set (tchar)
 * - RFC 9110 §5.6.4: quoted-string with quoted-pair (backslash escaping)
 * - RFC 9110 §11.2: auth-param names MUST be unique per challenge (case-insensitive)
 * - RFC 7235 §2.1: challenge disambiguation between token68 and auth-params
 *
 * @see https://www.rfc-editor.org/rfc/rfc9110.html#section-11.6.1
 * @see https://www.rfc-editor.org/rfc/rfc7235.html#section-2.1
 */

import { isLoopback } from "./discovery"

export type Challenge = {
  scheme: string
  params: Record<string, string>
  token68?: string
}

/**
 * RFC 9110 §5.6.2: token character set.
 * tchar = "!" / "#" / "$" / "%" / "&" / "'" / "*" / "+" / "-" / "." /
 *         "^" / "_" / "`" / "|" / "~" / DIGIT / ALPHA
 */
const TOKEN_RE = /^[!#$%&'*+\-.^_`|~A-Za-z0-9]+$/

/** RFC 7235 §2.1: token68 = 1*( ALPHA / DIGIT / "-" / "." / "_" / "~" / "+" / "/" ) *"=" */
const TOKEN68_RE = /^[A-Za-z0-9\-._~+/]+=*$/

function isTokenChar(c: string): boolean {
  return TOKEN_RE.test(c)
}

function skipOWS(input: string, i: number): number {
  while (i < input.length && (input[i] === " " || input[i] === "\t")) i++
  return i
}

function parseToken(input: string, i: number): { value: string; end: number } | undefined {
  const start = i
  while (i < input.length && isTokenChar(input[i]!)) i++
  if (i === start) return undefined
  return { value: input.slice(start, i), end: i }
}

/**
 * RFC 9110 §5.6.4: quoted-pair allows only HTAB / SP / VCHAR / obs-text
 * after the backslash. This excludes NUL, most C0 controls, and DEL.
 * - HTAB = 0x09
 * - SP   = 0x20
 * - VCHAR = 0x21-0x7E
 * - obs-text = 0x80-0xFF
 */
function isQuotedPairChar(c: string): boolean {
  const code = c.charCodeAt(0)
  return code === 0x09 || (code >= 0x20 && code !== 0x7f)
}

/**
 * Parse a quoted-string per RFC 9110 §5.6.4.
 * quoted-string = DQUOTE *( qdtext / quoted-pair ) DQUOTE
 * quoted-pair   = "\" ( HTAB / SP / VCHAR / obs-text )
 */
function parseQuotedString(input: string, i: number): { value: string; end: number } | undefined {
  if (input[i] !== '"') return undefined
  i++
  // Use array accumulation instead of repeated string concatenation to avoid
  // O(n^2) copying. Each `result += c` creates a new string; for a quoted
  // string of length N this causes ~N/2 allocations with increasing sizes.
  const parts: string[] = []
  let start = i
  while (i < input.length) {
    const c = input[i]!
    if (c === '"') {
      if (i > start) parts.push(input.slice(start, i))
      return { value: parts.join(""), end: i + 1 }
    }
    if (c === "\\" && i + 1 < input.length) {
      const escaped = input[i + 1]!
      // RFC 9110 §5.6.4: quoted-pair only allows HTAB / SP / VCHAR / obs-text
      if (!isQuotedPairChar(escaped)) return undefined
      if (i > start) parts.push(input.slice(start, i))
      parts.push(escaped)
      i += 2
      start = i
      continue
    }
    i++
  }
  // RFC 9110 §5.6.4: grammar requires a closing DQUOTE; reject malformed strings
  return undefined
}

function parseTokenOrQuoted(input: string, i: number): { value: string; end: number } | undefined {
  if (input[i] === '"') return parseQuotedString(input, i)
  return parseToken(input, i)
}

function parseToken68(input: string, i: number): { value: string; end: number } | undefined {
  const start = i
  while (i < input.length && input[i] !== " " && input[i] !== "\t" && input[i] !== ",") i++
  const candidate = input.slice(start, i)
  if (!candidate || !TOKEN68_RE.test(candidate)) return undefined
  return { value: candidate, end: i }
}

/**
 * Peek ahead to check if the next content is "token = value" (an auth-param).
 * Used to disambiguate between token68 and auth-params, and between a new
 * challenge scheme and continuation params.
 *
 * Checks for a complete "token BWS = BWS (token | quoted-string)" pattern,
 * not just "token =", to avoid misclassifying token68 values like "dGVzdA=="
 * where the trailing "=" is part of base64 padding, not a param separator.
 */
function isNextParam(input: string, i: number): boolean {
  i = skipOWS(input, i)
  const tok = parseToken(input, i)
  if (!tok) return false
  const afterTok = skipOWS(input, tok.end)
  if (input[afterTok] !== "=") return false
  // Verify a valid value follows the "="
  const afterEq = skipOWS(input, afterTok + 1)
  if (afterEq >= input.length) return false
  if (input[afterEq] === '"') return true
  return parseToken(input, afterEq) !== undefined
}

/**
 * Parse a complete WWW-Authenticate header value into challenges.
 *
 * The parser handles the notoriously ambiguous WWW-Authenticate grammar by using
 * a peek-ahead strategy: after reading a comma, it checks whether the next
 * content is "token = value" (another param) or a bare token (new challenge scheme).
 *
 * Per RFC 9110 §11.2, auth-param names are checked for uniqueness within each
 * challenge (case-insensitive). Challenges with duplicate params are rejected.
 *
 * @param header - Raw WWW-Authenticate header value
 * @returns Array of parsed challenges. Invalid challenges are silently skipped.
 */
export function parse(header: string): Challenge[] {
  const challenges: Challenge[] = []
  let pos = 0

  while (pos < header.length) {
    pos = skipOWS(header, pos)

    // Skip leading commas (RFC 7235 §2.1 allows empty list members)
    while (pos < header.length && header[pos] === ",") {
      pos++
      pos = skipOWS(header, pos)
    }
    if (pos >= header.length) break

    // Parse scheme
    const scheme = parseToken(header, pos)
    if (!scheme) {
      pos++
      continue
    }
    pos = skipOWS(header, scheme.end)

    // Bare scheme (end of input or comma)
    if (pos >= header.length || header[pos] === ",") {
      challenges.push({ scheme: scheme.value, params: {} })
      if (pos < header.length && header[pos] === ",") pos++
      continue
    }

    // Try token68 first: peek to see if it looks like "token =" (auth-param)
    // If not, try token68
    const t68 = parseToken68(header, pos)
    if (t68) {
      const after68 = skipOWS(header, t68.end)
      // token68 must be followed by end, comma, or new scheme — not "="
      if (after68 >= header.length || header[after68] === ",") {
        challenges.push({ scheme: scheme.value, params: {}, token68: t68.value })
        pos = after68
        if (pos < header.length && header[pos] === ",") pos++
        continue
      }
    }

    // Parse auth-params
    const params: Record<string, string> = {}
    let duplicate = false

    while (pos < header.length) {
      pos = skipOWS(header, pos)
      const name = parseToken(header, pos)
      if (!name) break

      pos = skipOWS(header, name.end)
      if (pos >= header.length || header[pos] !== "=") {
        // No "=" — this is a new scheme, not a param. Backtrack.
        pos = name.end - name.value.length
        break
      }
      pos++ // skip "="
      pos = skipOWS(header, pos)

      const val = parseTokenOrQuoted(header, pos)
      if (!val) {
        // If we failed on a quoted-string the remaining input is corrupted —
        // skip to end to prevent phantom challenges from the unmatched content.
        if (pos < header.length && header[pos] === '"') pos = header.length
        break
      }

      // RFC 9110 §11.2: param names MUST be unique per challenge (case-insensitive)
      const normalized = name.value.toLowerCase()
      if (normalized in params) duplicate = true
      params[normalized] = val.value
      pos = skipOWS(header, val.end)

      if (pos < header.length && header[pos] === ",") {
        const comma = pos
        pos++
        // Peek: is the next thing another param (token "=") or a new challenge?
        if (isNextParam(header, pos)) continue
        // It's a new challenge — leave pos after the comma
        pos = comma + 1
        break
      }
      break
    }

    // RFC 9110 §11.2: reject challenges with duplicate param names
    if (!duplicate) {
      challenges.push(
        Object.keys(params).length > 0
          ? { scheme: scheme.value, params }
          : { scheme: scheme.value, params: {} },
      )
    }

    pos = skipOWS(header, pos)
    if (pos < header.length && header[pos] === ",") pos++
  }

  return challenges
}

/**
 * Extract all WWW-Authenticate challenges from a Response.
 * Handles multiple WWW-Authenticate header values per RFC 9110 §5.3.
 *
 * @param response - HTTP response to extract challenges from
 * @returns All parsed challenges across all WWW-Authenticate header values
 */
export function all(response: Response): Challenge[] {
  const result: Challenge[] = []
  const values: string[] = []
  response.headers.forEach((val, key) => {
    if (key.toLowerCase() === "www-authenticate") values.push(val)
  })
  for (const val of values) {
    result.push(...parse(val))
  }
  return result
}

/**
 * Extract the resource_metadata URL from Bearer challenges per RFC 9728 §5.1.
 *
 * RFC 9728 §5.1: The resource server MAY include a "resource_metadata" parameter
 * in Bearer challenges to indicate where its protected resource metadata can be found.
 *
 * @param challenges - Parsed challenges from WWW-Authenticate
 * @returns The resource_metadata URL if found in a Bearer challenge, undefined otherwise
 */
export function resourceMetadataUrl(challenges: Challenge[]): string | undefined {
  // RFC 9728 §5.1: resource_metadata MAY appear in any auth scheme (not just Bearer).
  // DPoP and future schemes can also carry this parameter.
  for (const c of challenges) {
    const url = c.params["resource_metadata"]
    if (!url) continue
    // Validate the URL is HTTPS (or HTTP loopback) before returning it.
    // The value comes from an untrusted server and could point at internal
    // services (SSRF), use non-HTTP schemes (file://), or be garbage.
    try {
      const parsed = new URL(url)
      if (parsed.protocol === "https:") return url
      if (parsed.protocol === "http:" && isLoopback(parsed.hostname)) return url
    } catch {
      continue
    }
  }
  return undefined
}
