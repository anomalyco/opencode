export * as OpenCodeWorkerd from "./workerd"

import { ServerWorkerd } from "@opencode-ai/server/workerd"
import { Layer } from "effect"
import * as OpenCode from "./opencode"
import type { LogOptions } from "./logging"

export type CreateOptions = ServerWorkerd.Options & {
  readonly log?: LogOptions
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
export const create = ({ log, ...options }: CreateOptions) =>
  OpenCode.create({ ...ServerWorkerd.serverOptions(options), log }, { overrides: ServerWorkerd.replacements(options) })

export const layer = (options: CreateOptions) => Layer.effect(OpenCode.Service, create(options))
