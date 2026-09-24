import {
  AIError,
  InvalidProviderOutputError,
  InvalidRequestError,
  UnsupportedOperationError,
  type ProviderID,
} from "../schema/index.js"

export const eventError = (route: string, message: string, body?: string, cause?: unknown) =>
  new AIError({
    reason: new InvalidProviderOutputError({ route, message, body, cause }),
  })

/** Canonical invalid-request constructor shared by protocol lowering. */
export const invalidRequest = (message: string, cause?: unknown) =>
  new AIError({
    reason: new InvalidRequestError({ message, cause }),
  })

/**
 * Canonical constructor for operations the selected route does not implement.
 * Prefer this over `invalidRequest` when the failure is a missing route
 * capability rather than a malformed caller input, so consumers can branch on
 * `reason._tag` plus `reason.operation` instead of matching message text.
 */
export const unsupportedOperation = (input: {
  readonly operation: string
  readonly message: string
  readonly provider?: ProviderID
  readonly route?: string
  readonly cause?: unknown
}) =>
  new AIError({
    reason: new UnsupportedOperationError({
      operation: input.operation,
      message: input.message,
      provider: input.provider,
      route: input.route,
      cause: input.cause,
    }),
  })
