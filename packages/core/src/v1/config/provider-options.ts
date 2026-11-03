export * as ConfigProviderOptionsV1 from "./provider-options.js"

import { isRecord } from "@opencode/util/record"

type Options = Readonly<Record<string, unknown>>

export interface ProviderResult {
  readonly settings: Record<string, unknown>
  readonly headers?: Record<string, string>
  readonly body?: Record<string, unknown>
}

export function provider(options: Options): ProviderResult {
  const headers = options.headers
  const body = options.body
  const settings = Object.fromEntries(Object.entries(options).filter(([key]) => key !== "headers" && key !== "body"))
  const headerOverlay = isRecord(headers)
    ? Object.fromEntries(
        Object.entries(headers).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
      )
    : undefined
  const bodyOverlay = isRecord(body) ? { ...body } : undefined
  return {
    settings,
    headers: headerOverlay,
    body: bodyOverlay,
  }
}

export function model(options: Options) {
  return { ...options }
}

// Model options read before the request is built; v1's `@ai-sdk/openai-compatible` sent every other one verbatim
// in the request body.
const COMPATIBLE_KEYS = new Set([
  "apiKey",
  "baseURL",
  "headers",
  "body",
  "extraBody",
  "timeout",
  "chunkTimeout",
  "headerTimeout",
  "disabled",
  "reasoningEffort",
  "textVerbosity",
  "user",
  "strictJsonSchema",
])

export function compatibleModel(options: Options) {
  const entries = Object.entries(options)
  const body = Object.fromEntries(entries.filter(([key]) => !COMPATIBLE_KEYS.has(key)))
  return {
    settings: Object.fromEntries(entries.filter(([key]) => COMPATIBLE_KEYS.has(key))),
    body: Object.keys(body).length ? body : undefined,
  }
}
