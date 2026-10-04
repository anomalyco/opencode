export type SessionStatusLike = { readonly type: string } | undefined

export type RevertOutcome = { readonly ok: true } | { readonly ok: false; readonly error: unknown }

/**
 * Revert a message the way the /undo command does.
 *
 * The server rejects revert with a 409 while a turn is running
 * (SessionRevert.revert -> SessionRunState.assertNotBusy), so a running turn
 * must be cancelled first. Cancelling is skipped when the session is idle.
 */
export async function revertMessage(input: {
  readonly sessionID: string
  readonly messageID: string
  readonly status: SessionStatusLike
  readonly abort: (input: { sessionID: string }) => Promise<unknown>
  readonly revert: (input: { sessionID: string; messageID: string }) => Promise<{ error?: unknown } | undefined>
}): Promise<RevertOutcome> {
  if (input.status?.type !== "idle") {
    await input.abort({ sessionID: input.sessionID }).catch(() => {})
  }

  return input.revert({ sessionID: input.sessionID, messageID: input.messageID }).then(
    (result) => (result?.error === undefined ? { ok: true as const } : { ok: false as const, error: result.error }),
    (error) => ({ ok: false as const, error }),
  )
}
