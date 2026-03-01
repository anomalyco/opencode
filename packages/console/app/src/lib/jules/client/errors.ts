// Jules-specific error types

export class JulesAuthError extends Error {
  status = 401 as const
  constructor(message = "Missing or invalid Jules API key") {
    super(message)
    this.name = "JulesAuthError"
  }
}

export class JulesNotFoundError extends Error {
  status = 404 as const
  constructor(resource: string) {
    super("Not found: " + resource)
    this.name = "JulesNotFoundError"
  }
}

export class JulesRateLimitError extends Error {
  status = 429 as const
  constructor(message = "Jules API rate limit exceeded") {
    super(message)
    this.name = "JulesRateLimitError"
  }
}

export class JulesUpstreamError extends Error {
  status: number
  upstream: string
  constructor(status: number, message: string) {
    super("Jules API error: " + message)
    this.name = "JulesUpstreamError"
    this.status = status
    this.upstream = message
  }
}

export class JulesValidationError extends Error {
  status = 400 as const
  constructor(message: string) {
    super("Validation error: " + message)
    this.name = "JulesValidationError"
  }
}

export type JulesError =
  | JulesAuthError
  | JulesNotFoundError
  | JulesRateLimitError
  | JulesUpstreamError
  | JulesValidationError

export function error(status: number, body: string): JulesError {
  if (status === 401 || status === 403) return new JulesAuthError(body)
  if (status === 404) return new JulesNotFoundError(body)
  if (status === 429) return new JulesRateLimitError(body)
  return new JulesUpstreamError(status, body)
}
