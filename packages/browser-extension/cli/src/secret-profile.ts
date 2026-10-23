import * as AuthProfile from "./auth-profile.ts"

export type Summary = AuthProfile.AuthProfileSummary
export type RunResult = AuthProfile.AuthRunResult
export type RunOptions = AuthProfile.AuthRunOptions
export type StatusOptions = AuthProfile.AuthProfileOptions
export type Error = AuthProfile.AuthProfileError
export const Error = AuthProfile.AuthProfileError

/** Return profile metadata without revealing credential values. */
export const status = AuthProfile.status

/**
 * Run a trusted credential-bearing worker with profile slots injected as BC_SECRET_N.
 * Known values are redacted from bounded stdout and stderr before they return.
 */
export const run = AuthProfile.run
