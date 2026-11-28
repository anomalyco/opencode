export * as OpenCodeWorkerd from "./workerd"

import { PromiseSdk } from "./internal/promise"
import { WorkerdProfile } from "./internal/workerd"
import type { LogOptions } from "./logging"
import { OpenCode } from "./opencode"

export type Configuration = WorkerdProfile.Configuration

export interface CreateOptions extends WorkerdProfile.Options {
  readonly log?: LogOptions
  readonly plugins?: OpenCode.CreateOptions["plugins"]
  readonly workspaceProviders?: OpenCode.CreateOptions["workspaceProviders"]
  readonly instances?: OpenCode.CreateOptions["instances"]
}

export type Interface = OpenCode.Interface & {
  /**
   * Serves a request from outside the Durable Object, as `ServerWorkerd.create`'s handler does: `/api/*` and the
   * `/api/event` stream behind `password` and the cross-site and CORS checks, and machine-link WebSocket upgrades.
   * Return it from the Durable Object's `fetch()` method.
   */
  readonly fetch: (request: Request) => Promise<Response>
  /** Suspends any workspaces past their idle threshold; call from the Durable Object's `alarm()` method. */
  readonly alarm: () => Promise<void>
}

/**
 * Boots the embedded opencode SDK on the workerd runtime profile: the full
 * application graph inside a Cloudflare Durable Object, with the database on
 * the injected `DurableObjectStorage` SQLite and every intentionally-local
 * service replaced or disabled (see `ServerWorkerd.replacements`).
 *
 * Suspended Sessions resume on boot (as on every runtime) because a Durable
 * Object can be evicted mid-turn with no teardown; the write-ahead execution
 * claim marks the turn and the boot-time sweep replays it.
 *
 * Forward the Durable Object's `fetch()` to `opencode.fetch(request)` to serve
 * the HTTP API and machine links, and its `alarm()` to `opencode.alarm()` so
 * idle remote workspaces suspend while the Durable Object hibernates at zero
 * idle cost.
 *
 * Returns the same typed `OpenCode.Interface` as `OpenCode.create` plus
 * `fetch()` and `alarm()` — typed session operations plus the live
 * `events.subscribe()` stream — served over an in-process fetch transport, so
 * no request leaves the isolate.
 */
export const create = async (options: CreateOptions): Promise<Interface> => {
  const created = await PromiseSdk.createWithHost(
    {
      log: options.log,
      plugins: options.plugins,
      workspaceProviders: options.workspaceProviders,
      instances: options.instances,
    },
    { profile: WorkerdProfile.make(options) },
  )
  return {
    ...created.sdk,
    fetch: created.host.handler,
    alarm: async () => {
      await created.sdk.workspace.suspendIdle()
    },
  }
}
