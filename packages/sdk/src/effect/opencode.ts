export * as OpenCode from "./opencode"

import type { OpenCodeClient } from "@opencode/client/effect"
import type { Session } from "@opencode/core/session"
import type { Workspace } from "@opencode/core/workspace"
import { Context, Layer } from "effect"
import type { Config, Effect, Scope } from "effect"
import { EffectSdk } from "../internal/effect"
import type { EmbeddedHost } from "../internal/host"
import type { SdkInstances } from "../internal/instances"

export type { LogEntry, LogLevel, LogOptions, LogWriter } from "../logging"

export type CreateOptions<R = never> = EmbeddedHost.CreateOptions<R>
/**
 * @deprecated Runtime-profile overrides are an internal hook; use `OpenCodeWorkerd.create` from
 * `@opencode/sdk/workerd/effect` for the workerd profile. Removed in the next minor.
 */
export type EmbedOptions = EmbeddedHost.EmbedOptions
export type InstanceOptions<R = never> = SdkInstances.Options<R>
export type InstanceConfiguration = SdkInstances.Configuration

export type Interface = Omit<OpenCodeClient, "plugin" | "session" | "event"> & {
  /** @deprecated Use `sessions`, whose `create`, `get` and `move` run in-process. Removed in the next minor. */
  readonly session: OpenCodeClient["session"]
  /** @deprecated Use `events`. Removed in the next minor. */
  readonly event: OpenCodeClient["event"]
  readonly sessions: Omit<OpenCodeClient["session"], "create" | "get" | "move"> & {
    readonly create: Session.Interface["create"]
    readonly get: (input: { readonly sessionID: Session.ID }) => ReturnType<Session.Interface["get"]>
    readonly move: Session.Interface["move"]
  }
  readonly events: OpenCodeClient["event"]
  readonly workspace: {
    readonly create: Workspace.Interface["create"]
    readonly attach: Workspace.Interface["attach"]
    readonly provision: (options: {
      readonly workspaceID: Workspace.ID
    }) => ReturnType<Workspace.Interface["provision"]>
    readonly destroy: (options: { readonly workspaceID: Workspace.ID }) => ReturnType<Workspace.Interface["destroy"]>
    readonly suspendIdle: Workspace.Interface["suspendIdle"]
  }
  readonly plugin: EmbeddedHost.Interface["plugins"]["register"] & OpenCodeClient["plugin"]
}

export const create: {
  <R = never>(options?: CreateOptions<R>): Effect.Effect<Interface, Config.ConfigError | Error, Scope.Scope | R>
  /**
   * @deprecated `embed` is an internal hook; use `OpenCodeWorkerd.create` from `@opencode/sdk/workerd/effect` for
   * the workerd profile. Removed in the next minor.
   */
  <R = never>(
    options: CreateOptions<R> | undefined,
    embed: EmbedOptions | undefined,
  ): Effect.Effect<Interface, Config.ConfigError | Error, Scope.Scope | R>
} = EffectSdk.create

export class Service extends Context.Service<Service, Interface>()("@opencode/sdk/OpenCode") {}

export const layer = <R = never>(
  options: CreateOptions<R> = {},
): Layer.Layer<Service, Config.ConfigError | Error, Exclude<R, Scope.Scope>> => Layer.effect(Service, create(options))
