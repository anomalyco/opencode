import { Media } from "../media.js"
import { isRecord } from "./record.js"

export const sanitizeSurrogates = <T>(value: T): T => {
  if (typeof value === "string") return value.toWellFormed() as T
  if (Array.isArray(value)) return value.map(sanitizeSurrogates) as T
  // Media assets carry binary or base64 payloads and a lazy byte cache; flattening them into a record would drop both.
  if (value instanceof Uint8Array || value instanceof Error || value instanceof Media.Asset) return value
  if (isRecord(value))
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key.toWellFormed(), sanitizeSurrogates(entry)]),
    ) as T
  return value
}
