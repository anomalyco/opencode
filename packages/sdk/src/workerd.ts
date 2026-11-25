export * as OpenCodeWorkerd from "./workerd"

import { Effect } from "effect"
import { WorkerdProfile } from "./internal/workerd"
import type { LogOptions } from "./logging"
import { PromiseSdk } from "./promise"

export type Configuration = WorkerdProfile.Configuration

export interface CreateOptions extends WorkerdProfile.Options {
  readonly log?: LogOptions
  readonly plugins?: PromiseSdk.CreateOptions["plugins"]
  readonly instances?: PromiseSdk.CreateOptions["instances"]
}

export type Interface = PromiseSdk.Interface & {
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
 * Forward the Durable Object's `alarm()` lifecycle method to `opencode.alarm()`
 * so idle remote workspaces suspend while the Durable Object hibernates at
 * zero idle cost.
 *
 * Returns the same typed `OpenCode.Interface` as `OpenCode.create` plus
 * `alarm()` — typed session operations plus the live `events.subscribe()`
 * stream — served over an in-process fetch transport, so no request leaves the
 * isolate.
 */
export const create = async ({ log, plugins, instances, ...options }: CreateOptions): Promise<Interface> => {
  const profile = WorkerdProfile.make(options)
  const { sdk, host } = await PromiseSdk.createWithHost(
    { ...profile.options, log, plugins, instances },
    { overrides: profile.replacements },
  )
  return {
    ...sdk,
    alarm: () => host.runtime.runPromise(Effect.asVoid(host.workspace.suspendIdle())),
  }
}
