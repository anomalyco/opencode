export * as ConfigProviderOptionsV1 from "./provider-options.js"

import type { Model } from "@opencode/schema/model"

type Options = Readonly<Record<string, unknown>>

export interface ProviderResult {
  readonly settings: Record<string, unknown>
  readonly headers?: Record<string, string>
  readonly body?: Record<string, unknown>
  readonly compatibility?: Model.Compatibility
}

export function provider(options: Options): ProviderResult {
  const headers = options.headers
  const body = options.body
  const settings = Object.fromEntries(
    Object.entries(options).filter(([key]) => key !== "headers" && key !== "body" && key !== "setCacheKey"),
  )
  const headerOverlay =
    typeof headers === "object" && headers !== null && !Array.isArray(headers)
      ? Object.fromEntries(
          Object.entries(headers).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
        )
      : undefined
  const bodyOverlay = typeof body === "object" && body !== null && !Array.isArray(body) ? { ...body } : undefined
  return {
    settings,
    headers: headerOverlay,
    body: bodyOverlay,
    // V1 `setCacheKey` was a provider-wide switch for sending the prompt cache key; false also disabled the
    // built-in defaults for OpenAI and xAI.
    compatibility:
      typeof options.setCacheKey === "boolean" ? { supportsPromptCacheKey: options.setCacheKey } : undefined,
  }
}

export function model(options: Options) {
  return { ...options }
}
