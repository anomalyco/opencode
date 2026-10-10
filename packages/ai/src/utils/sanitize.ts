import { Media } from "../media.js"
import { isRecord } from "./record.js"

// Unchanged values are returned as-is so Schema class instances skip re-validation; changed instances become plain records that callers re-decode.
export const sanitizeSurrogates = <T>(value: T): T => {
  if (typeof value === "string") return value.toWellFormed() as T
  if (Array.isArray(value)) {
    const items = value.map(sanitizeSurrogates)
    return (items.every((item, index) => item === value[index]) ? value : items) as T
  }
  // Media assets carry binary or base64 payloads and a lazy byte cache; flattening them into a record would drop both.
  if (value instanceof Uint8Array || value instanceof Error || value instanceof Media.Asset) return value
  if (isRecord(value)) {
    const entries = Object.entries(value)
    const sanitized = entries.map(([key, entry]) => [key.toWellFormed(), sanitizeSurrogates(entry)] as const)
    return (
      sanitized.every(([key, entry], index) => key === entries[index][0] && entry === entries[index][1])
        ? value
        : Object.fromEntries(sanitized)
    ) as T
  }
  return value
}
