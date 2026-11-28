export * as OpenCode from "./opencode"

import type { OpenCodeClient } from "@opencode/client"
import type { Workspace } from "@opencode/core/workspace"
import type { Plugin } from "@opencode/plugin"
import type { Session } from "@opencode/schema/session"
import type { Effect } from "effect"
import type { EmbeddedHost } from "./internal/host"
import { PromiseSdk } from "./internal/promise"

export type { LogEntry, LogLevel, LogOptions, LogWriter } from "./logging"

export interface InstanceConfiguration {
  readonly plugins: ReadonlyArray<Plugin.Plugin>
}

export interface InstanceOptions {
  /** Select a sharing key within the Session's current Location. Must not initialize plugins. */
  readonly key: (session: typeof Session.Info.Encoded) => string
  /** Reconstruct configuration on a cache miss, including after a host restart. */
  readonly configure: (key: string) => InstanceConfiguration | Promise<InstanceConfiguration>
}

export interface CreateOptions extends Omit<EmbeddedHost.CreateOptions, "plugins" | "instances"> {
  readonly plugins?: ReadonlyArray<Plugin.Plugin>
  readonly instances?: InstanceOptions
}

type Settled<A extends (...args: never) => Effect.Effect<unknown, unknown, unknown>> = Promise<
  Effect.Success<ReturnType<A>>
>

/** Remote workspaces, run in-process; each rejects with the error its Effect fails with. */
export interface WorkspaceInterface {
  /** Commits a logical workspace ID for `provider` at once; no provider work happens until it is used. */
  readonly create: (input: Parameters<Workspace.Interface["create"]>[0]) => Settled<Workspace.Interface["create"]>
  /** Registers an already-provisioned binding without calling the driver's `create`. */
  readonly attach: (input: Parameters<Workspace.Interface["attach"]>[0]) => Settled<Workspace.Interface["attach"]>
  /** Starts or joins the attempt that makes the backing resource real, then returns it. */
  readonly provision: (input: { readonly workspaceID: Workspace.ID }) => Settled<Workspace.Interface["provision"]>
  /** Makes the workspace absent, reporting whether this call destroyed an existing one. */
  readonly destroy: (input: { readonly workspaceID: Workspace.ID }) => Settled<Workspace.Interface["destroy"]>
  /** Suspends workspaces past their idle threshold and returns their IDs. */
  readonly suspendIdle: () => Settled<Workspace.Interface["suspendIdle"]>
}

export type Interface = Omit<OpenCodeClient, "plugin" | "session" | "event"> & {
  /** @deprecated Use `sessions`. Removed in the next minor. */
  readonly session: OpenCodeClient["session"]
  /** @deprecated Use `events`. Removed in the next minor. */
  readonly event: OpenCodeClient["event"]
  readonly sessions: OpenCodeClient["session"]
  readonly events: OpenCodeClient["event"]
  readonly workspace: WorkspaceInterface
  readonly plugin: ((plugin: Plugin.Plugin) => Promise<void>) & OpenCodeClient["plugin"]
  readonly close: () => Promise<void>
  readonly [Symbol.asyncDispose]: () => Promise<void>
}

export async function create(options: CreateOptions = {}): Promise<Interface> {
  return (await PromiseSdk.createWithHost(options)).sdk
}
