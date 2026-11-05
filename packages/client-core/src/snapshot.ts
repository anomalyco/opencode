export * as WorkspaceSnapshot from "./snapshot.js"

import { ConfigIntegration } from "@opencode/core/config/integration"
import { Option, Schema } from "effect"
import { ConnectStore } from "./store.js"

/** OpenCode re-fetches its workspace config every minute; the connector treats a snapshot that old as stale. */
export const MAX_AGE_MS = 60_000

export interface Info extends Schema.Schema.Type<typeof Info> {}
export const Info = Schema.Struct({
  /** `ConsoleCredentials.owner` of the sign-in the config was fetched for. */
  owner: Schema.String,
  /** The workspace's name, which policy denials show. */
  organization: Schema.optional(Schema.String),
  /** When the Console last answered, in epoch milliseconds. */
  fetched: Schema.Number,
  /** The Console's config document, absent when it serves none for this sign-in. */
  config: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
  /** Why the sign-in needs the member, such as an expired SSO session, while the last config stays in force. */
  status: Schema.optional(Schema.Struct({ message: Schema.String, url: Schema.optional(Schema.String) })),
})

const decode = Schema.decodeUnknownOption(Schema.fromJsonString(Info))
const Telemetry = Schema.Struct({
  otlpLogsUrl: Schema.String,
  headers: Schema.optional(Schema.Record(Schema.String, Schema.String)),
})
const Library = Schema.Struct({
  instructions: Schema.optional(Schema.Array(Schema.Struct({ id: Schema.String, content: Schema.String }))),
  skills: Schema.optional(Schema.Array(Schema.Struct({ slug: Schema.String, version: Schema.String }))),
})
const Providers = Schema.Record(
  Schema.String,
  Schema.Struct({ models: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)) }),
)
const Experimental = Schema.Struct({ policies: Schema.optional(Schema.Unknown) })

export function read(store: ConnectStore.Info) {
  return Option.getOrUndefined(decode(ConnectStore.read(ConnectStore.snapshotFile(store)) ?? ""))
}

export function write(store: ConnectStore.Info, snapshot: Info) {
  ConnectStore.write(ConnectStore.snapshotFile(store), JSON.stringify(snapshot))
}

export function clear(store: ConnectStore.Info) {
  ConnectStore.remove(ConnectStore.snapshotFile(store))
}

export function stale(snapshot: Info, now: number) {
  return now - snapshot.fetched >= MAX_AGE_MS
}

/**
 * The workspace's policy statements in order, or `undefined` while they are unknown: nothing fetched yet, a sign-in
 * that needed the member before any config arrived, or statements this version can't read. Callers enforcing policy
 * treat unknown as deny. Statements with an action or effect a newer Console added drop out.
 */
export function policies(snapshot: Info | undefined) {
  if (!snapshot) return undefined
  const config = snapshot.config
  if (!config) return snapshot.status ? undefined : []
  const statements =
    config.policies ?? Option.getOrUndefined(Schema.decodeUnknownOption(Experimental)(config.experimental))?.policies
  if (statements === undefined) return []
  return Option.getOrUndefined(Schema.decodeUnknownOption(ConfigIntegration.Policies)(statements))
}

/** Workspace Library instructions and skill versions, or `undefined` when the workspace offers none. */
export function library(snapshot: Info | undefined) {
  return field(snapshot, "library", Library)
}

/** Where the workspace asks connected clients to export usage metadata, once it turns that on. */
export function telemetry(snapshot: Info | undefined) {
  return field(snapshot, "telemetry", Telemetry)
}

/** How many models the workspace serves this member through its gateway. */
export function models(snapshot: Info | undefined) {
  return Object.values(field(snapshot, "providers", Providers) ?? {}).reduce(
    (count, provider) => count + Object.keys(provider.models ?? {}).length,
    0,
  )
}

/**
 * Whether a harness should send its model traffic through the workspace's gateway or keep its own provider sign-in,
 * such as a Claude Max or ChatGPT seat. A workspace that serves the member no models leaves the provider in place.
 */
export function routing(snapshot: Info | undefined, options: { readonly keepProvider?: boolean } = {}) {
  return options.keepProvider || models(snapshot) === 0 ? ("keep-provider" as const) : ("gateway" as const)
}

// Each field decodes on its own, so one a newer Console changed can't hide the others.
function field<S extends Schema.Decoder<unknown>>(snapshot: Info | undefined, key: string, schema: S) {
  const value = snapshot?.config?.[key]
  return value === undefined ? undefined : Option.getOrUndefined(Schema.decodeUnknownOption(schema)(value))
}
