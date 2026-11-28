export * as OpenCodeWorkerd from "./workerd"

import { Effect, Layer } from "effect"
import type { Config, Scope } from "effect"
import { EffectSdk } from "../internal/effect"
import { WorkerdProfile } from "../internal/workerd"
import { OpenCode } from "./opencode"

export type Configuration = WorkerdProfile.Configuration

export interface CreateOptions<R = never> extends WorkerdProfile.Options {
  readonly log?: OpenCode.CreateOptions["log"]
  readonly plugins?: OpenCode.CreateOptions["plugins"]
  readonly workspaceProviders?: OpenCode.CreateOptions["workspaceProviders"]
  readonly instances?: OpenCode.CreateOptions<R>["instances"]
}

export type Interface = OpenCode.Interface & {
  /**
   * Serves a request from outside the Durable Object, as `ServerWorkerd.create`'s handler does: `/api/*` and the
   * `/api/event` stream behind `password` and the cross-site and CORS checks, and machine-link WebSocket upgrades.
   * A Promise, because the Durable Object's `fetch()` method returns one.
   */
  readonly fetch: (request: Request) => Promise<Response>
  /** Suspends any workspaces past their idle threshold; run from the Durable Object's `alarm()` method. */
  readonly alarm: Effect.Effect<void>
}

export const create = <R = never>(
  options: CreateOptions<R>,
): Effect.Effect<Interface, Config.ConfigError | Error, Scope.Scope | R> =>
  EffectSdk.createWithHost(
    {
      log: options.log,
      plugins: options.plugins,
      workspaceProviders: options.workspaceProviders,
      instances: options.instances,
    },
    { profile: WorkerdProfile.make(options) },
  ).pipe(
    Effect.map((created) => ({
      ...created.sdk,
      fetch: created.host.handler,
      alarm: Effect.asVoid(created.sdk.workspace.suspendIdle()),
    })),
  )

export const layer = <R = never>(
  options: CreateOptions<R>,
): Layer.Layer<OpenCode.Service, Config.ConfigError | Error, Exclude<R, Scope.Scope>> =>
  Layer.effect(OpenCode.Service, create(options))

export type Requirements = Scope.Scope
