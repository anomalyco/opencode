export * as OpenCodeWorkerd from "./workerd"

import { WorkerdProfile } from "./internal/workerd"
import type { LogOptions } from "./logging"
import { PromiseSdk } from "./promise"

export type Configuration = WorkerdProfile.Configuration

export interface CreateOptions extends WorkerdProfile.Options {
  readonly log?: LogOptions
  readonly plugins?: PromiseSdk.CreateOptions["plugins"]
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
 * Returns the same typed `OpenCode.Interface` as `OpenCode.create` — typed
 * session operations plus the live `events.subscribe()` stream — served over
 * an in-process fetch transport, so no request leaves the isolate.
 */
export const create = ({ log, plugins, ...options }: CreateOptions) => {
  const profile = WorkerdProfile.make(options)
  return PromiseSdk.create({ ...profile.options, log, plugins }, { overrides: profile.replacements })
}

export type Interface = PromiseSdk.Interface
