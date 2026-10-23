import { Predicate } from "effect"

export type CredentialSlot = {
  readonly ref: string
  value: string
  readonly sources: readonly string[]
  expiresAt?: string
}

type RedactionSlot = Pick<CredentialSlot, "ref" | "value">
type MutableCredentialSlot = Omit<CredentialSlot, "sources"> & { readonly sources: string[] }

const secretNamePattern = /auth(?:orization)?|cookie|credential|csrf|xsrf|token|secret|session|password|passwd|pwd|passcode|otp|(?:^|[-_.])code(?:$|[-_.])|(?:api|access|refresh)[-_.]?key|signature|(?:^|[-_.])sig(?:$|[-_.])/i
const secretHeaders = new Set([
  "authorization",
  "proxy-authorization",
  "x-api-key",
  "api-key",
  "x-csrf-token",
  "csrf-token",
  "x-xsrf-token",
])

export class SecretCollector {
  private readonly slotsByRef = new Map<string, MutableCredentialSlot>()
  private readonly refsByValue = new Map<string, string>()
  private readonly refsBySource = new Map<string, string>()
  // Retired values are redaction-only: never include them in persisted profile slots.
  private readonly retiredRefsByValue = new Map<string, string>()
  private nextRef = 1
  private updated = new Set<string>()
  private observed = new Set<string>()

  constructor(existing: readonly CredentialSlot[] = []) {
    for (const slot of existing) {
      const copy: MutableCredentialSlot = {
        ref: slot.ref,
        value: slot.value,
        sources: [...slot.sources],
        ...(slot.expiresAt ? { expiresAt: slot.expiresAt } : {}),
      }
      this.slotsByRef.set(copy.ref, copy)
      this.refsByValue.set(copy.value, copy.ref)
      for (const source of copy.sources) {
        this.refsBySource.set(source, copy.ref)
      }
      const number = /^BC_SECRET_(\d+)$/.exec(copy.ref)?.[1]
      if (number) this.nextRef = Math.max(this.nextRef, Number(number) + 1)
    }
  }

  protectHeaders(headers: readonly { readonly name: string; readonly value: string }[], location: "request" | "response", requestScope = ""): Array<{ name: string; value: string }> {
    const occurrences = new Map<string, number>()
    return headers.map(({ name, value }) => {
      const lowerName = name.toLowerCase()
      const occurrence = occurrences.get(lowerName) ?? 0
      occurrences.set(lowerName, occurrence + 1)
      return {
      name,
        value: this.protectHeader(name, value, sourceName(requestScope, `${location}.header.${lowerName}`, occurrence)),
      }
    })
  }

  protectUrl(rawUrl: string, requestScope = ""): string {
    const fragmentStart = rawUrl.indexOf("#")
    const base = fragmentStart < 0 ? rawUrl : rawUrl.slice(0, fragmentStart)
    const protectQuery = (name: string, value: string, occurrence: number) => this.reference(
      value,
      sourceName(requestScope, `query.${name}`, occurrence),
    )
    let protectedUrl: string
    try {
      const url = new URL(base)
      url.search = protectSearchParams(url.searchParams, protectQuery).toString()
      protectedUrl = restoreReferencePlaceholders(url.toString())
    } catch {
      protectedUrl = protectRelativeUrl(base, protectQuery)
    }
    if (fragmentStart < 0) return protectedUrl
    const fragment = protectFragment(rawUrl.slice(fragmentStart + 1), (name, value, occurrence) => this.reference(
      value,
      sourceName(requestScope, `fragment.${name}`, occurrence),
    ))
    return `${protectedUrl}#${fragment}`
  }

  protectBody(body: string, contentType: string | undefined, location: "request" | "response", requestScope = ""): string | undefined {
    const type = contentType?.toLowerCase() ?? ""
    if (type.includes("json")) {
      try {
        return JSON.stringify(this.protectJson(JSON.parse(body), sourceName(requestScope, location)))
      } catch {
        return undefined
      }
    }
    if (type.includes("application/x-www-form-urlencoded")) {
      const protectedParams = protectSearchParams(new URLSearchParams(body), (name, value, occurrence) =>
        this.reference(value, sourceName(requestScope, `${location}.form.${name}`, occurrence)))
      return restoreReferencePlaceholders(protectedParams.toString())
    }
    if (type.includes("multipart/form-data")) {
      return this.protectMultipart(body, contentType ?? "", location, requestScope)
    }
    return undefined
  }

  slots(): readonly CredentialSlot[] {
    return Array.from(this.slotsByRef.values())
      .sort((left, right) => left.ref.localeCompare(right.ref, undefined, { numeric: true }))
      .map((slot) => ({ ...slot, sources: [...slot.sources] }))
  }

  updatedRefs(): readonly string[] {
    return Array.from(this.updated).sort()
  }

  observedRefs(): readonly string[] {
    return Array.from(this.observed).sort()
  }

  redactText(text: string): string {
    return redactKnownValues(text, this.redactionSlots())
  }

  redactValue(value: unknown): unknown {
    return redactKnownValue(value, this.redactionSlots())
  }

  redactExactValue(value: unknown, minimumLength: number): unknown {
    if (!Predicate.isString(value) && !Predicate.isNumber(value) && !Predicate.isBoolean(value)) return value
    const serialized = String(value)
    if (serialized.length < minimumLength) return value
    const ref = this.refsByValue.get(serialized) ?? this.retiredRefsByValue.get(serialized)
    return ref ? `\${${ref}}` : value
  }

  private redactionSlots(): readonly RedactionSlot[] {
    return [...this.slotsByRef.values(), ...Array.from(this.retiredRefsByValue, ([value, ref]) => ({ ref, value }))]
  }

  private protectHeader(name: string, value: string, source: string): string {
    if (!value) return value
    const lower = name.toLowerCase()
    if (lower === "cookie" || lower === "set-cookie") {
      const cookieOccurrences = new Map<string, number>()
      return value.split(/;\s*/).map((part, index) => {
        const separator = part.indexOf("=")
        if (separator < 1) return part
        const cookieName = part.slice(0, separator).trim()
        const cookieValue = part.slice(separator + 1)
        if (lower === "set-cookie" && index > 0 && /^(domain|path|expires|max-age|samesite)$/i.test(cookieName)) {
          return part
        }
        if (!cookieValue) return part
        const occurrence = cookieOccurrences.get(cookieName) ?? 0
        cookieOccurrences.set(cookieName, occurrence + 1)
        return `${cookieName}=${this.reference(cookieValue, sourceName("", `${source}.${cookieName}`, occurrence))}`
      }).join("; ")
    }
    if (lower === "location" || lower === "referer" || lower === "referrer") {
      return this.protectUrl(value, `${source}.url`)
    }
    if (lower === "authorization" || lower === "proxy-authorization") {
      const match = /^(\S+)\s+(.+)$/.exec(value)
      if (match) return `${match[1]} ${this.reference(match[2] ?? "", source)}`
    }
    if (secretHeaders.has(lower) || secretNamePattern.test(lower)) {
      return this.reference(value, source)
    }
    return value
  }

  private protectJson(value: unknown, location: string, path: readonly string[] = [], inSecret = false): unknown {
    if (Array.isArray(value)) {
      return value.map((item, index) => this.protectJson(item, location, [...path, String(index)], inSecret))
    }
    if (Predicate.isObject(value)) {
      return Object.fromEntries(Object.entries(value).map(([key, item]) => [
        key,
        this.protectJson(item, location, [...path, key], inSecret || secretNamePattern.test(key)),
      ]))
    }
    if (!inSecret || value === null || value === "") return value
    return this.reference(String(value), `${location}.json.${path.join(".")}`)
  }

  private protectMultipart(body: string, contentType: string, location: "request" | "response", requestScope: string): string | undefined {
    const boundary = /boundary=(?:"([^"]+)"|([^;\s]+))/i.exec(contentType)?.slice(1).find(Boolean)
    if (!boundary) return undefined
    const delimiter = `--${boundary}`
    const parts = body.split(delimiter)
    if (parts.length < 3) return undefined
    const occurrences = new Map<string, number>()
    for (let index = 1; index < parts.length - 1; index += 1) {
      const part = parts[index]
      if (!part?.startsWith("\r\n")) return undefined
      const headerEnd = part.indexOf("\r\n\r\n")
      if (headerEnd < 0 || !part.endsWith("\r\n")) return undefined
      const headers = part.slice(2, headerEnd)
      const disposition = headers.split("\r\n").find((line) => /^content-disposition:/i.test(line))
      if (!disposition || /;\s*filename\*?=/i.test(disposition)) return undefined
      const name = /;\s*name="([^"]+)"/i.exec(disposition)?.[1]
      if (!name) return undefined
      const valueStart = headerEnd + 4
      const valueEnd = part.length - 2
      const value = part.slice(valueStart, valueEnd)
      if (!value || !secretNamePattern.test(name)) continue
      const occurrence = occurrences.get(name) ?? 0
      occurrences.set(name, occurrence + 1)
      const reference = this.reference(value, sourceName(requestScope, `${location}.multipart.${name}`, occurrence))
      parts[index] = `${part.slice(0, valueStart)}${reference}${part.slice(valueEnd)}`
    }
    return parts.join(delimiter)
  }

  private reference(value: string, source: string): string {
    const sourceRef = this.refsBySource.get(source)
    if (sourceRef) {
      const slot = this.slotsByRef.get(sourceRef)
      if (slot) {
        if (slot.value === value) {
          this.observed.add(sourceRef)
          return `\${${sourceRef}}`
        }
        if (slot.sources.length === 1) {
          this.retiredRefsByValue.set(slot.value, slot.ref)
          if (this.refsByValue.get(slot.value) === sourceRef) this.refsByValue.delete(slot.value)
          slot.value = value
          const expiresAt = jwtExpiration(value)
          if (expiresAt) slot.expiresAt = expiresAt
          else delete slot.expiresAt
          this.refsByValue.set(value, sourceRef)
          this.updated.add(sourceRef)
          this.observed.add(sourceRef)
          return `\${${sourceRef}}`
        }
        const sourceIndex = slot.sources.indexOf(source)
        if (sourceIndex >= 0) slot.sources.splice(sourceIndex, 1)
        const replacementRef = this.refsByValue.get(value)
        if (replacementRef) {
          this.refsBySource.set(source, replacementRef)
          this.addSource(replacementRef, source)
          this.updated.add(replacementRef)
          this.observed.add(replacementRef)
          return `\${${replacementRef}}`
        }
      }
    }
    const valueRef = this.refsByValue.get(value)
    if (valueRef) {
      this.observed.add(valueRef)
      this.addSource(valueRef, source)
      return `\${${valueRef}}`
    }
    const ref = `BC_SECRET_${this.nextRef++}`
    const expiresAt = jwtExpiration(value)
    this.slotsByRef.set(ref, { ref, value, sources: [source], ...(expiresAt ? { expiresAt } : {}) })
    this.refsByValue.set(value, ref)
    this.refsBySource.set(source, ref)
    this.updated.add(ref)
    this.observed.add(ref)
    return `\${${ref}}`
  }

  private addSource(ref: string, source: string): void {
    const slot = this.slotsByRef.get(ref)
    if (!slot || slot.sources.includes(source)) return
    slot.sources.push(source)
    this.refsBySource.set(source, ref)
  }
}

function restoreReferencePlaceholders(value: string): string {
  return value.replace(/(?:%24|\$)%7B(BC_SECRET_\d+)%7D/gi, (_match, ref: string) => `\${${ref}}`)
}

/** Protect the query of a fragment-free URL that `new URL` cannot parse. */
function protectRelativeUrl(
  rawUrl: string,
  protect: (name: string, value: string, occurrence: number) => string,
): string {
  const queryStart = rawUrl.indexOf("?")
  if (queryStart < 0) return rawUrl
  const protectedQuery = protectSearchParams(new URLSearchParams(rawUrl.slice(queryStart + 1)), protect).toString()
  return restoreReferencePlaceholders(`${rawUrl.slice(0, queryStart)}?${protectedQuery}`)
}

function protectSearchParams(
  params: URLSearchParams,
  protect: (name: string, value: string, occurrence: number) => string,
): URLSearchParams {
  const result = new URLSearchParams()
  const occurrences = new Map<string, number>()
  for (const [name, value] of params) {
    const occurrence = occurrences.get(name) ?? 0
    occurrences.set(name, occurrence + 1)
    result.append(name, value && secretNamePattern.test(name) ? protect(name, value, occurrence) : value)
  }
  return result
}

function protectFragment(
  fragment: string,
  protect: (name: string, value: string, occurrence: number) => string,
): string {
  const occurrences = new Map<string, number>()
  return fragment.split("&").map((part) => {
    const separator = part.indexOf("=")
    if (separator < 1) return part
    const entry = new URLSearchParams(part).entries().next().value
    if (!entry) return part
    const [name, value] = entry
    // Recognize parameter names, not route/anchor text containing token-like words.
    if (!/^[\w.-]+$/.test(name) || !secretNamePattern.test(name)) return part
    const occurrence = occurrences.get(name) ?? 0
    occurrences.set(name, occurrence + 1)
    return value ? `${part.slice(0, separator + 1)}${protect(name, value, occurrence)}` : part
  }).join("&")
}

function sourceName(requestScope: string, location: string, occurrence = 0): string {
  const base = requestScope ? `${requestScope}.${location}` : location
  return occurrence === 0 ? base : `${base}.${occurrence}`
}

export function redactKnownValues(text: string, slots: readonly RedactionSlot[]): string {
  return [...slots]
    .sort((left, right) => right.value.length - left.value.length)
    .reduce((output, slot) => replaceOutsideReferences(output, slot.value, `\${${slot.ref}}`), text)
}

function redactKnownValue(value: unknown, slots: readonly RedactionSlot[]): unknown {
  if (Predicate.isString(value)) return redactKnownValues(value, slots)
  if (Predicate.isNumber(value) || Predicate.isBoolean(value)) {
    const slot = slots.find((candidate) => candidate.value === String(value))
    return slot ? `\${${slot.ref}}` : value
  }
  if (Array.isArray(value)) return value.map((item) => redactKnownValue(item, slots))
  if (!Predicate.isObject(value)) return value
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [
    key,
    secretNamePattern.test(key) ? redactSecretValue(item) : redactKnownValue(item, slots),
  ]))
}

function redactSecretValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactSecretValue)
  if (Predicate.isObject(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redactSecretValue(item)]))
  }
  return value === null || value === "" ? value : "[REDACTED]"
}

function replaceOutsideReferences(text: string, value: string, replacement: string): string {
  if (!value) return text
  const referencePattern = /\$\{BC_SECRET_\d+\}/g
  let output = ""
  let offset = 0
  for (const match of text.matchAll(referencePattern)) {
    const index = match.index ?? 0
    output += text.slice(offset, index).split(value).join(replacement)
    output += match[0]
    offset = index + match[0].length
  }
  return output + text.slice(offset).split(value).join(replacement)
}

function jwtExpiration(value: string): string | undefined {
  const parts = value.split(".")
  if (parts.length !== 3 || !parts[1]) return undefined
  try {
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as { exp?: unknown }
    return Predicate.isNumber(payload.exp) ? new Date(payload.exp * 1_000).toISOString() : undefined
  } catch {
    return undefined
  }
}
