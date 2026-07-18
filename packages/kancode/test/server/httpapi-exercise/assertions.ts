import type { CallResult, JsonObject } from "./types"

export function parse(text: string): unknown {
  if (!text) return undefined
  try {
    return JSON.parse(text) as unknown
  } catch {
    return text
  }
}

export function looksJson(result: CallResult) {
  return result.contentType.includes("application/json") || result.text.startsWith("{") || result.text.startsWith("[")
}

export function stable(value: unknown): string {
  return JSON.stringify(sort(value))
}

function sort(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sort)
  if (!value || typeof value !== "object") return value
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, sort(item)]),
  )
}

export function array(value: unknown): asserts value is unknown[] {
  if (!Array.isArray(value)) throw new Error("expected array")
}

export function object(value: unknown): asserts value is JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("expected object")
}

export function boolean(value: unknown): asserts value is boolean {
  if (typeof value !== "boolean") throw new Error("expected boolean")
}

export function isRecord(value: unknown): value is JsonObject {
  return !!value && typeof value === "object" && !Array.isArray(value)
}

export function check(value: boolean, message: string): asserts value {
  if (!value) throw new Error(message)
}

export function message(error: unknown) {
  if (error instanceof Error) return error.message
  return String(error)
}

export function pad(value: string, size: number) {
  return value.length >= size ? value : value + " ".repeat(size - value.length)
}

export function indent(value: string) {
  return value
    .split("\n")
    .map((line) => `  ${line}`)
    .join("\n")
}
