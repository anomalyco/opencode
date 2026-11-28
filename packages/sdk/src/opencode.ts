export * as OpenCode from "./opencode"

import type { OpenCodeClient } from "@opencode/client"
import type { Plugin } from "@opencode/plugin"
import type { Session } from "@opencode/schema/session"
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

export interface CreateOptions
  extends Omit<EmbeddedHost.CreateOptions, "plugins" | "workspaceProviders" | "instances"> {
  readonly plugins?: ReadonlyArray<Plugin.Plugin>
  readonly instances?: InstanceOptions
}

export type Interface = Omit<OpenCodeClient, "plugin" | "session" | "event"> & {
  /** @deprecated Use `sessions`. Removed in the next minor. */
  readonly session: OpenCodeClient["session"]
  /** @deprecated Use `events`. Removed in the next minor. */
  readonly event: OpenCodeClient["event"]
  readonly sessions: OpenCodeClient["session"]
  readonly events: OpenCodeClient["event"]
  readonly plugin: ((plugin: Plugin.Plugin) => Promise<void>) & OpenCodeClient["plugin"]
  readonly close: () => Promise<void>
  readonly [Symbol.asyncDispose]: () => Promise<void>
}

export async function create(options: CreateOptions = {}): Promise<Interface> {
  return (await PromiseSdk.createWithHost(options)).sdk
}
