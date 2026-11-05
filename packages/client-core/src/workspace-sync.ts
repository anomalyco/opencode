export * as WorkspaceSync from "./workspace-sync.js"

import { ConsoleAccess } from "@opencode/core/console-access"
import { Clock, Effect, Result, Schema } from "effect"
import { HttpClient, HttpClientRequest } from "effect/http"
import { ConsoleCredentials } from "./credentials.js"
import { WorkspaceSnapshot } from "./snapshot.js"
import type { ConnectStore } from "./store.js"

const encode = Schema.encodeUnknownSync(ConsoleAccess.Config)

/**
 * Names the connector, and the harness it runs for, on every Console request. The Console reads these to tell which
 * client a member runs and whether it enforces the policies it is sent.
 */
export function identify(http: HttpClient.HttpClient, input: { readonly version: string; readonly harness?: string }) {
  return HttpClient.mapRequest(
    http,
    HttpClientRequest.setHeaders({ "user-agent": userAgent(input), "x-opencode-plugin": `connect/${input.version}` }),
  )
}

export function userAgent(input: { readonly version: string; readonly harness?: string }) {
  return [input.harness, `opencode-connect/${input.version}`].filter(Boolean).join(" ")
}

/**
 * Brings the stored workspace config up to date, as OpenCode does every minute: a snapshot younger than a minute is
 * reused unless `force` is set.
 *
 * A failed fetch for the same sign-in keeps the last snapshot, so a Console outage never lifts the workspace's
 * policies. Signing out, or signing in as another member or workspace, never reuses one. When the sign-in itself needs
 * the member (an expired SSO session, a revoked session) the last snapshot also stays, with the reason in `status`.
 */
export const sync = Effect.fn("WorkspaceSync.sync")(function* (
  store: ConnectStore.Info,
  http: HttpClient.HttpClient,
  options: { readonly force?: boolean } = {},
) {
  const signedIn = ConsoleCredentials.read(store)
  if (!signedIn) {
    WorkspaceSnapshot.clear(store)
    return { snapshot: undefined }
  }
  const now = yield* Clock.currentTimeMillis
  const cached = WorkspaceSnapshot.read(store)
  const previous = cached?.owner === ConsoleCredentials.owner(signedIn) ? cached : undefined
  if (previous && !options.force && !WorkspaceSnapshot.stale(previous, now)) return { snapshot: previous }

  const outcome = yield* ConsoleCredentials.fresh(store, http).pipe(
    Effect.flatMap((credential) =>
      credential
        ? ConsoleAccess.fetchConfig(http, credential).pipe(Effect.map((config) => ({ credential, config })))
        : Effect.succeed(undefined),
    ),
    Effect.result,
  )
  if (Result.isSuccess(outcome)) {
    if (!outcome.success) {
      WorkspaceSnapshot.clear(store)
      return { snapshot: undefined }
    }
    const next: WorkspaceSnapshot.Info = {
      owner: ConsoleCredentials.owner(outcome.success.credential),
      organization: ConsoleAccess.organizationName(outcome.success.credential),
      fetched: now,
      config: outcome.success.config && encode(outcome.success.config),
    }
    WorkspaceSnapshot.write(store, next)
    return { snapshot: next }
  }
  const status = needsMember(outcome.failure)
  if (!status) return { snapshot: previous, error: outcome.failure }
  const next: WorkspaceSnapshot.Info = {
    ...(previous ?? {
      owner: ConsoleCredentials.owner(signedIn),
      organization: ConsoleAccess.organizationName(signedIn),
    }),
    fetched: now,
    status,
  }
  WorkspaceSnapshot.write(store, next)
  return { snapshot: next, error: outcome.failure }
})

// Only these answers are about the sign-in; anything else may be transient.
function needsMember(cause: unknown) {
  if (cause instanceof ConsoleAccess.SsoRequiredError)
    return { message: ConsoleAccess.ssoMessage(cause.organization), url: cause.url }
  if (cause instanceof ConsoleAccess.SignedOutError) return { message: ConsoleAccess.signedOutMessage }
  return undefined
}
