export * as ConfigProviderOptionsV1 from "./provider-options"

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
  }
}

export function model(options: Options) {
  return { ...options }
}
