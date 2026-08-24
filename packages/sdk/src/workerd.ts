export * as OpenCodeWorkerd from "./workerd"

import type { DurableObjectStorage } from "@opencode-ai/core/database/sqlite.workerd"
import { ServerWorkerd } from "@opencode-ai/server/workerd"
import { Config, Effect, Layer, Scope } from "effect"
import * as OpenCode from "./opencode"

export interface CreateOptions extends Pick<OpenCode.CreateOptions, "log" | "workspaceProviders"> {
  readonly storage: DurableObjectStorage
  readonly app?: OpenCode.CreateOptions["app"]
  readonly password?: string
  readonly config?: { readonly content?: string }
  readonly models?: OpenCode.CreateOptions["models"]
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
export const create: (
  options: CreateOptions,
) => Effect.Effect<OpenCode.Interface, Config.ConfigError | Error, Scope.Scope> = ({
  log,
  workspaceProviders,
  ...options
}) =>
  OpenCode.create(
    { ...ServerWorkerd.serverOptions(options), log, workspaceProviders },
    { overrides: ServerWorkerd.replacements(options) },
  )

export const layer = (options: CreateOptions): Layer.Layer<OpenCode.Service, Config.ConfigError | Error> =>
  Layer.effect(OpenCode.Service, create(options))
