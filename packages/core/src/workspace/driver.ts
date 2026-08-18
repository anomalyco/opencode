export * as WorkspaceDriver from "./driver.js"

import { Workspace } from "@opencode-ai/schema/workspace"
import { makeGlobalNode } from "@opencode-ai/util/effect/app-node"
import { Context, Effect, Layer, Schema } from "effect"
import type { Scope } from "effect"
import type { Driver as EnvironmentDriver } from "../environment/driver.js"

/**
 * Smallest provider-owned JSON value required to reconnect to the same
 * provider resource. Core stores it opaquely and hands it back; only the
 * owning driver reads inside.
 */
export const Binding = Schema.Record(Schema.String, Schema.Json)
export type Binding = typeof Binding.Type

export class Error extends Schema.TaggedError<Error>()("WorkspaceDriver.Error", {
  message: Schema.optional(Schema.String),
  cause: Schema.optional(Schema.Defect()),
}) {}

export class ProviderNotFound extends Schema.TaggedError<ProviderNotFound>()("WorkspaceDriver.ProviderNotFound", {
  provider: Schema.String,
}) {}

export interface Interface {
  readonly create: (input: {
    readonly workspaceID: Workspace.ID
  }) => Effect.Effect<{ readonly binding: Binding }, Error>
  readonly connect: (input: {
    readonly workspaceID: Workspace.ID
    readonly binding: Binding
    readonly saveBinding: (binding: Binding) => Effect.Effect<void>
  }) => Effect.Effect<EnvironmentDriver, Error, Scope.Scope>
  readonly suspendForIdle: (input: {
    readonly workspaceID: Workspace.ID
    readonly binding: Binding
    readonly saveBinding: (binding: Binding) => Effect.Effect<void>
  }) => Effect.Effect<void, Error>
  readonly destroy: (input: {
    readonly workspaceID: Workspace.ID
    readonly binding: Binding
  }) => Effect.Effect<void, Error>
}

export const make = (driver: Interface) => driver

export interface Registry {
  readonly get: (provider: string) => Effect.Effect<Interface, ProviderNotFound>
}

export class RegistryService extends Context.Service<RegistryService, Registry>()(
  "@opencode/WorkspaceDriverRegistry",
) {}

export const registry = (drivers: Readonly<Record<string, Interface>>): Registry => ({
  get: (provider) => {
    const driver = Object.hasOwn(drivers, provider) ? drivers[provider] : undefined
    return driver ? Effect.succeed(driver) : Effect.fail(new ProviderNotFound({ provider }))
  },
})

export const registryNode = (drivers: Readonly<Record<string, Interface>>) =>
  makeGlobalNode({
    service: RegistryService,
    layer: Layer.succeed(RegistryService, RegistryService.of(registry(drivers))),
    deps: [],
  })

export const node = registryNode({})
