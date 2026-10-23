import type { Effect, Semaphore } from "effect"
import type { ExecuteOptions, ExecuteResult } from "./execute.ts"
import type { NetworkCaptureOptions, NetworkCaptureResult, NetworkCaptureStatus, NetworkCaptureStopOptions } from "./network-capture.ts"
import type { JsonObject, TargetInfo } from "./protocol.ts"
import type { AuthenticatedJsonOutcome, AuthenticatedJsonRequest, SessionSummary } from "./relay-schema.ts"
export type SessionTarget = {
  readonly id: string
  readonly owner: "relay" | "user"
}

export type ConnectedTarget = {
  readonly tabId: number
  readonly sessionId: string
  /**
   * The OpenCode Browser session the tab was created for. Owned tabs are
   * visible only to that session's CDP clients; unowned tabs (user
   * toolbar-attached or raw-client-created) are visible to every client.
   */
  readonly opencodeBrowserSessionId?: string
  readonly targetInfo: TargetInfo
  readonly owner: "relay" | "user"
  readonly crashed?: boolean
  /**
   * `chrome.debugger` currently rejects every command for this tab because a
   * protected frame (another extension's UI, such as a password manager's
   * inline menu) is open inside it. Cleared when a command succeeds again or
   * the last protected frame goes away.
   */
  readonly protectedUi?: boolean
}

export type ChildTarget = {
  readonly tabId: number
  readonly sessionId: string
  readonly parentSessionId: string
  readonly targetInfo: TargetInfo
  readonly waitingForDebugger: boolean
}

export type StoredFrameEvents = {
  readonly frameId: string
  readonly attached?: JsonObject
  readonly navigated?: JsonObject
}

export type PendingExtensionRequest = {
  readonly resolve: (value: JsonObject) => void
  readonly reject: (error: Error) => void
  readonly debuggerTabId?: number
}

/**
 * The sandbox seam used by session management. `ExecuteSandbox` is the real
 * implementation; tests can substitute a fake.
 */
export interface ExecuteSandboxLike {
  execute(code: string, options?: ExecuteOptions): Effect.Effect<ExecuteResult>
  authenticatedJson(request: Omit<AuthenticatedJsonRequest, "sessionId">): Effect.Effect<AuthenticatedJsonOutcome, Error>
  adoptPage(targetId: string): Effect.Effect<void, Error>
  /** Shutdown and handoff cancellation await disconnection without closing or forgetting the default tab. */
  disconnectSettled(): Effect.Effect<void, Error>
  /** Adoption rollback cleanup does not settle before started Playwright close promises settle. */
  closeSettled(): Effect.Effect<void, Error>
  networkStart(options?: NetworkCaptureOptions): Effect.Effect<NetworkCaptureStatus, Error>
  networkStatus(): NetworkCaptureStatus
  networkStop(options?: NetworkCaptureStopOptions): Effect.Effect<NetworkCaptureResult, Error>
  networkCancel(): Effect.Effect<{ readonly cancelled: boolean }>
  authRefresh(options: { readonly name: string; readonly urlFilter?: string; readonly timeoutMs?: number }): Effect.Effect<NetworkCaptureResult, Error>
  redactNetworkCaptureText(text: string): string
  markTargetCrashed(targetId: string): boolean
  markTargetProtectedUi(targetId: string, protectedUi: boolean): boolean
  markTargetDetached(targetId: string): boolean
  markTargetReplaced(previousTargetId: string, targetId: string): boolean
  restore(target: SessionTarget | undefined): void
  getStatus(): {
    readonly sessionId?: string
    readonly connected: boolean
    readonly pageUrl: string | null
    readonly stateKeys: string[]
  }
}

export type OpenCodeBrowserSession = {
  readonly id: string
  readonly createdAt: string
  readonly readOnly: boolean
  readonly sandbox: ExecuteSandboxLike
  readonly executeSemaphore: Semaphore.Semaphore
  /** Durable default-target identity. Authoritative live ownership remains in TargetRegistry. */
  target?: SessionTarget
  updatedAt: string
}

export type { SessionSummary }
