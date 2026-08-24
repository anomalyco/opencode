export * as OpenCode from "./opencode"

import { OpenCode, type OpenCodeClient } from "@opencode-ai/client/effect"
import type { Workspace } from "@opencode-ai/core/workspace"
import { Context, Effect, Layer } from "effect"
import type { Config, Scope } from "effect"
import { FetchHttpClient } from "effect/unstable/http"
import { EmbeddedHost } from "../internal/host"

export type { LogEntry, LogLevel, LogOptions, LogWriter } from "../logging"

export type CreateOptions = EmbeddedHost.CreateOptions
export type EmbedOptions = EmbeddedHost.EmbedOptions

export type Interface = Omit<OpenCodeClient, "plugin" | "workspace"> & {
  readonly sessions: OpenCodeClient["session"]
  readonly events: OpenCodeClient["event"]
  readonly workspace: {
    readonly create: (options: { readonly provider: string }) => ReturnType<Workspace.Interface["create"]>
    readonly provision: (options: {
      readonly workspaceID: Workspace.ID
    }) => ReturnType<Workspace.Interface["provision"]>
    readonly destroy: (options: { readonly workspaceID: Workspace.ID }) => ReturnType<Workspace.Interface["destroy"]>
  }
  readonly plugin: EmbeddedHost.Interface["plugins"]["register"] & OpenCodeClient["plugin"]
}

const make = Effect.fn("OpenCode.make")(function* (options: CreateOptions = {}, embed: EmbedOptions = {}) {
  const host = yield* Effect.acquireRelease(EmbeddedHost.create(options, embed), (host) => Effect.promise(host.close))
  const client = yield* OpenCode.make({ baseUrl: "http://opencode.local" }).pipe(
    Effect.provide(
      FetchHttpClient.layer.pipe(Layer.provide(Layer.succeed(FetchHttpClient.Fetch, host.fetch)), Layer.fresh),
    ),
  )

  return {
    opencode: {
      ...client,
      sessions: client.session,
      events: client.event,
      workspace: {
        create: ({ provider }: { readonly provider: string }) => host.workspace.create(provider),
        provision: ({ workspaceID }: { readonly workspaceID: Workspace.ID }) => host.workspace.provision(workspaceID),
        destroy: ({ workspaceID }: { readonly workspaceID: Workspace.ID }) => host.workspace.destroy(workspaceID),
      },
      plugin: Object.assign(host.plugins.register, client.plugin),
    },
    start: host.start,
  }
})

export const create: (
  options?: CreateOptions,
  embed?: EmbedOptions,
) => Effect.Effect<Interface, Config.ConfigError | Error, Scope.Scope> = Effect.fn("OpenCode.create")(function* (
  options: CreateOptions = {},
  embed: EmbedOptions = {},
) {
  const host = yield* make(options, embed)
  yield* host.start
  return host.opencode
})

export class Service extends Context.Service<Service, Interface>()("@opencode-ai/sdk/OpenCode") {}

export const layer = (options: CreateOptions = {}): Layer.Layer<Service, Config.ConfigError | Error> =>
  Layer.effect(Service, create(options))

/** Builds a registration layer before starting suspended-session recovery. */
export const layerWith = <E, R>(
  registration: Layer.Layer<never, E, R>,
  options: CreateOptions = {},
  embed: EmbedOptions = {},
): Layer.Layer<Service, Config.ConfigError | Error | E, Exclude<R, Service>> =>
  Layer.unwrap(
    make(options, embed).pipe(
      Effect.map((host) =>
        registration.pipe(
          Layer.provideMerge(Layer.succeed(Service, host.opencode)),
          Layer.tap(() => host.start),
        ),
      ),
    ),
  )
