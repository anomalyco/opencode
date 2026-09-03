export * as OpenCode from "./opencode"

import { OpenCode, type OpenCodeClient } from "@opencode-ai/client/effect"
import type { Workspace } from "@opencode-ai/core/workspace"
import { Context, Effect, Layer } from "effect"
import type { Config, Scope } from "effect"
import { FetchHttpClient } from "effect/unstable/http"
import { EmbeddedHost } from "../internal/host"
import type { SdkInstances } from "../internal/instances"

export type { LogEntry, LogLevel, LogOptions, LogWriter } from "../logging"

export type CreateOptions<R = never> = EmbeddedHost.CreateOptions<R>
export type EmbedOptions = EmbeddedHost.EmbedOptions
export type InstanceOptions<R = never> = SdkInstances.Options<R>
export type InstanceConfiguration = SdkInstances.Configuration

export type Interface = Omit<OpenCodeClient, "plugin" | "workspace"> & {
  readonly sessions: OpenCodeClient["session"]
  readonly events: OpenCodeClient["event"]
  readonly workspace: {
    readonly create: Workspace.Interface["create"]
    readonly provision: (options: {
      readonly workspaceID: Workspace.ID
    }) => ReturnType<Workspace.Interface["provision"]>
    readonly destroy: (options: { readonly workspaceID: Workspace.ID }) => ReturnType<Workspace.Interface["destroy"]>
  }
  readonly plugin: EmbeddedHost.Interface["plugins"]["register"] & OpenCodeClient["plugin"]
}

export const create: <R = never>(
  options?: CreateOptions<R>,
  embed?: EmbedOptions,
) => Effect.Effect<Interface, Config.ConfigError | Error, Scope.Scope | R> = Effect.fn("OpenCode.create")(function* <
  R = never,
>(options: CreateOptions<R> = {}, embed: EmbedOptions = {}) {
  const host = yield* Effect.acquireRelease(EmbeddedHost.create(options, embed), (host) => Effect.promise(host.close))
  const client = yield* OpenCode.make({ baseUrl: "http://opencode.local" }).pipe(
    Effect.provide(
      FetchHttpClient.layer.pipe(Layer.provide(Layer.succeed(FetchHttpClient.Fetch, host.fetch)), Layer.fresh),
    ),
  )

  return {
    ...client,
    sessions: client.session,
    events: client.event,
    workspace: {
      create: host.workspace.create,
      provision: ({ workspaceID }: { readonly workspaceID: Workspace.ID }) => host.workspace.provision(workspaceID),
      destroy: ({ workspaceID }: { readonly workspaceID: Workspace.ID }) => host.workspace.destroy(workspaceID),
    },
    plugin: Object.assign(host.plugins.register, client.plugin),
  }
})

export class Service extends Context.Service<Service, Interface>()("@opencode-ai/sdk/OpenCode") {}

export const layer = <R = never>(
  options: CreateOptions<R> = {},
): Layer.Layer<Service, Config.ConfigError | Error, Exclude<R, Scope.Scope>> => Layer.effect(Service, create(options))
