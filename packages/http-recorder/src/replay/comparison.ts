import { Option, Schema } from "effect"
import { REDACTED } from "../redaction/redactor.js"
import { secretFindings } from "../redaction/secrets.js"

export const decodeJson = Schema.decodeUnknownOption(Schema.UnknownFromJsonString)
const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value)

export const canonicalizeJson = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonicalizeJson)
  if (isRecord(value))
    return Object.fromEntries(
      Object.keys(value)
        .toSorted()
        .map((key) => [key, canonicalizeJson(value[key])]),
    )
  return value
}

export const safeText = (value: unknown) => {
  if (value === undefined) return "undefined"
  if (secretFindings(value).length > 0) return JSON.stringify(REDACTED)
  const text = JSON.stringify(value)
  if (!text) return typeof value
  return text.length > 300 ? `${text.slice(0, 300)}...` : text
}

export const jsonBody = (body: string) => Option.getOrUndefined(decodeJson(body))
export const isJsonRecord = isRecord
