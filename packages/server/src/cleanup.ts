export * as WorkspaceCleanup from "./cleanup"

import { Context, Effect } from "effect"

// ─── WorkspaceCleanup ──────────────────────────────────────────
//
// Defines the interface for per-user workspace directory cleanup.
// Implementation deferred — currently a placeholder contract so
// that Phase 2's directory structure design informs the signature.
//
// The directory structure is:
//   <data_root>/workspaces/<safe_userID>/
//
// A future implementation would remove the directory for a given
// userID when the user is deactivated or after a TTL.

export class CleanupError {
  readonly _tag = "CleanupError" as const
  constructor(readonly message: string) {}
}

export interface Interface {
  readonly cleanup: (userID: string) => Effect.Effect<void, CleanupError>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/WorkspaceCleanup") {}