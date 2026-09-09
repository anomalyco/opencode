import { isRecord } from "./record.js"

export const sanitizeSurrogates = <T>(value: T): T => {
  if (typeof value === "string") return value.toWellFormed() as T
  if (Array.isArray(value)) return value.map(sanitizeSurrogates) as T
  if (value instanceof Uint8Array || value instanceof Error) return value
  if (isRecord(value))
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key.toWellFormed(), sanitizeSurrogates(entry)]),
    ) as T
  return value
}
