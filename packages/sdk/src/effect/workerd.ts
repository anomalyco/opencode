export * as OpenCodeWorkerd from "./workerd"

import { Effect, Layer } from "effect"
import type { Config, Scope } from "effect"
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
  /** Suspends any workspaces past their idle threshold; run from the Durable Object's `alarm()` method. */
  readonly alarm: Effect.Effect<void>
}

export const create = <R = never>({
  log,
  plugins,
  workspaceProviders,
  instances,
  ...options
}: CreateOptions<R>): Effect.Effect<Interface, Config.ConfigError | Error, Scope.Scope | R> => {
  const profile = WorkerdProfile.make(options)
  return OpenCode.create(
    { ...profile.options, log, plugins, workspaceProviders, instances },
    { overrides: profile.replacements },
  ).pipe(
    Effect.map((opencode) => ({
      ...opencode,
      alarm: Effect.asVoid(opencode.workspace.suspendIdle()),
    })),
  )
}

export const layer = <R = never>(
  options: CreateOptions<R>,
): Layer.Layer<OpenCode.Service, Config.ConfigError | Error, Exclude<R, Scope.Scope>> =>
  Layer.effect(OpenCode.Service, create(options))

export type Requirements = Scope.Scope
