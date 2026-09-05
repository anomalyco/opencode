/**
 * Structural view of the generated client, narrowed to the one call this module
 * makes so a test fake satisfies the same shape as the production client.
 */
export type SessionAbortClient = {
  session: {
    abort: (parameters: { sessionID: string }, options: { throwOnError: true }) => Promise<unknown>
  }
}

export type SessionAbortInput = {
  client: SessionAbortClient
  sessionID: string
  /**
   * Called exactly once when the branch did not close. The value is whatever the
   * client rejected with; for a typed 500 the SDK's error interceptor has already
   * wrapped the failure into an `Error` carrying its message.
   */
  onFailure: (error: unknown) => void
}

export type SessionAbortActionInput<T> = SessionAbortInput & {
  /** Work whose safety depends on the branch actually being closed. */
  action: () => Promise<T>
}

/**
 * Requests branch closure and observes the outcome.
 *
 * `throwOnError: true` is required, not stylistic: the generated client defaults
 * to `ThrowOnError = false`, so a bare `session.abort(...)` resolves with an
 * `{ error }` object on a typed 500 and a `void`-ed call discards it entirely.
 * Throwing collapses HTTP failure and transport failure into one rejection
 * channel, which is what makes a single `onFailure` sufficient.
 *
 * Never rejects: failure is reported through `onFailure` and answered as `false`,
 * so a caller cannot mistake an unobserved rejection for success.
 */
export async function abortSessionBranch(input: SessionAbortInput): Promise<boolean> {
  return input.client.session
    .abort({ sessionID: input.sessionID }, { throwOnError: true })
    .then(() => true)
    .catch((error: unknown) => {
      input.onFailure(error)
      return false
    })
}

/**
 * Runs a dependent mutation only after branch closure succeeds.
 *
 * Kept beside `abortSessionBranch` so the ordering property stays directly
 * testable: observing the abort is not enough if a caller can still revert or
 * unrevert after the endpoint rejects.
 */
export async function runAfterSessionBranchAbort<T>(input: SessionAbortActionInput<T>): Promise<T | false> {
  const closed = await abortSessionBranch(input)
  if (!closed) return false
  return input.action()
}
