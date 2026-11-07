import type { FileDiffInfo } from "@opencode/client/promise"
import { Contract, type SessionRef } from "@opencode/plugin/gui"

/** Why the session directory's uncommitted changes did not load: the request failed, or took too long. */
export type ReviewDetailsFailure =
  | { readonly type: "rejected"; readonly message: string }
  | { readonly type: "timeout" }

/** What the session details' changes row shows. */
export type ReviewDetailsView =
  | { readonly status: "loading" }
  /** The server is unreachable and nothing loaded yet. */
  | { readonly status: "offline" }
  | { readonly status: "no-vcs" }
  /** The load failed; `retry` loads again. Never shown as a clean working tree. */
  | { readonly status: "error"; readonly failure: ReviewDetailsFailure }
  | { readonly status: "ready"; readonly rows: readonly FileDiffInfo[]; readonly version: number }

/**
 * The session directory's uncommitted changes, with how their load went. They load while a `details` watch on the
 * `Changes` contract holds.
 */
export interface ReviewDetails {
  /** What the changes row of `session` shows. Reactive. */
  readonly view: (session: SessionRef) => ReviewDetailsView
  /** Loads the changes of `session` again after a failure. */
  readonly retry: (session: SessionRef) => void
}

/** The review plugin provides this; the session details' changes row reads it. */
export const ReviewDetails = Contract.define<ReviewDetails, "review.details">("review.details")
