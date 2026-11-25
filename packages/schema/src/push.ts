export * as Push from "./push.js"

import { Schema } from "effect"
import { ephemeral, inventory } from "./event.js"
import { NonNegativeInt, optional } from "./schema.js"

export const DeviceID = Schema.String.check(
  Schema.isPattern(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/),
).annotate({ identifier: "Push.DeviceID", description: "A lowercase canonical UUID chosen by the phone" })
export type DeviceID = typeof DeviceID.Type

export const Time = NonNegativeInt.annotate({
  description: "Milliseconds since the Unix epoch",
})

export const Level = Schema.Literals(["all", "attention", "none"]).annotate({ identifier: "Push.Level" })
export type Level = typeof Level.Type

export interface Bell extends Schema.Schema.Type<typeof Bell> {}
export const Bell = Schema.Struct({
  level: Level,
  until: Time.pipe(optional),
}).annotate({ identifier: "Push.Bell" })

export interface Settings extends Schema.Schema.Type<typeof Settings> {}
export const Settings = Schema.Struct({
  paused: Schema.Boolean,
  until: Time.pipe(optional),
}).annotate({ identifier: "Push.Settings" })

export interface DeviceSettings extends Schema.Schema.Type<typeof DeviceSettings> {}
export const DeviceSettings = Schema.Struct({
  default: Level,
}).annotate({ identifier: "Push.DeviceSettings" })

export const Platform = Schema.Literals(["android", "ios"]).annotate({ identifier: "Push.Platform" })
export type Platform = typeof Platform.Type

export interface Register extends Schema.Schema.Type<typeof Register> {}
export const Register = Schema.Struct({
  callbackURL: Schema.String,
  expiresAt: Time,
  publicKey: Schema.String,
  platform: Platform,
  name: Schema.String,
  settings: DeviceSettings.pipe(optional),
}).annotate({ identifier: "Push.Register" })

export interface Registered extends Schema.Schema.Type<typeof Registered> {}
export const Registered = Schema.Struct({
  publicKey: Schema.String,
}).annotate({ identifier: "Push.Registered" })

export interface DevicePatch extends Schema.Schema.Type<typeof DevicePatch> {}
export const DevicePatch = Schema.Struct({
  paused: Schema.Boolean.pipe(optional),
  settings: DeviceSettings.pipe(optional),
}).annotate({ identifier: "Push.DevicePatch" })

export interface Device extends Schema.Schema.Type<typeof Device> {}
export const Device = Schema.Struct({
  id: DeviceID,
  name: Schema.String,
  platform: Platform,
  expiresAt: Time,
  settings: DeviceSettings,
  paused: Schema.Boolean,
  sessions: Schema.Record(Schema.String, Bell),
  time: Schema.Struct({
    created: Time,
    updated: Time,
  }),
}).annotate({ identifier: "Push.Device" })

export interface Info extends Schema.Schema.Type<typeof Info> {}
export const Info = Schema.Struct({
  settings: Settings,
  devices: Schema.Array(Device),
  sessions: Schema.Record(Schema.String, Bell),
}).annotate({ identifier: "Push.Info" })

const Updated = ephemeral({ type: "push.updated", schema: {} })
export const Event = { Updated, Definitions: inventory(Updated) }
