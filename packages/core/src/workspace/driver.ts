export * as WorkspaceDriver from "./driver"

import { Context, Effect, Layer, Schema, Scope } from "effect"
import { Workspace } from "@opencode-ai/schema/workspace"
import { makeGlobalNode } from "@opencode-ai/util/effect/app-node"
import type { WorkspaceEnvironment } from "./environment"

/**
 * Smallest provider-owned JSON value required to reconnect to the same
 * provider resource. Core stores it opaquely and hands it back; only the
 * owning driver reads inside.
 */
export const Binding = Schema.Record(Schema.String, Schema.Json)
export type Binding = typeof Binding.Type

export class Error extends Schema.TaggedErrorClass<Error>()("WorkspaceDriver.Error", {
  provider: Schema.String,
  message: Schema.optional(Schema.String),
  cause: Schema.optional(Schema.Defect()),
}) {}

export class ProviderNotFoundError extends Schema.TaggedErrorClass<ProviderNotFoundError>()(
  "WorkspaceDriver.ProviderNotFoundError",
  { provider: Schema.String },
) {}

export interface Interface {
  /** Allocate a new environment. Resolves only when it is ready to use. */
  readonly create: (input: {
    readonly workspaceID: Workspace.ID
  }) => Effect.Effect<{ readonly binding: Binding; readonly root: string }, Error>

  /**
   * Binding -> live capabilities; the only way to obtain an environment.
   * Fresh-create and restart-reconnect both flow through here. Closing the
   * scope drops the connection, never the provider resource.
   */
  readonly connect: (binding: Binding) => Effect.Effect<WorkspaceEnvironment.Interface, Error, Scope.Scope>

  /** Permanently release provider resources. */
  readonly destroy: (binding: Binding) => Effect.Effect<void, Error>
}

/** Identity constructor so driver definitions get contextual typing. */
export const make = (driver: Interface) => driver

export interface Registry {
  readonly get: (provider: string) => Effect.Effect<Interface, ProviderNotFoundError>
}

export class RegistryService extends Context.Service<RegistryService, Registry>()("@opencode/WorkspaceDriverRegistry") {}

/** Immutable registry fixed at composition time. */
export const registry = (drivers: Readonly<Record<string, Interface>>): Registry => ({
  get: (provider) => {
    const driver = drivers[provider]
    return driver ? Effect.succeed(driver) : Effect.fail(new ProviderNotFoundError({ provider }))
  },
})

/**
 * Defaults to no drivers, so every provider fails with ProviderNotFoundError.
 * Server composition (or a test) replaces this binding with real drivers;
 * core never constructs one.
 */
export const registryNode = makeGlobalNode({
  service: RegistryService,
  layer: Layer.succeed(RegistryService, RegistryService.of(registry({}))),
  deps: [],
})
