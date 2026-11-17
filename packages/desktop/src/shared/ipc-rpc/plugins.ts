import { Schema } from "effect"
import { Rpc, RpcGroup } from "effect/rpc"
import { Transferable } from "effect/workers"

const text = (maximum: number) => Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(maximum))

const id = text(256)

// Ipc payloads are already encoded by the plugin's own schemas and cross by structured
// clone, so the JSON codec passes them through untouched, bytes included. Encoded values must be
// JSON values or Uint8Arrays: the renderer drops undefined keys the way JSON would.
export const PluginPayload = Schema.declare((_: unknown): _ is unknown => true, { toCodecJson: () => undefined })

export const PluginErrorCode = Schema.Literals([
  // Calls into a main plugin's Ipc.
  "unavailable",
  "method",
  "input",
  "output",
  "failed",
  // The plugin manager.
  "notFound",
  // A built-in always runs, so it cannot be turned on or off.
  "builtin",
])

export type PluginErrorCode = typeof PluginErrorCode.Type

export const PluginFailure = Schema.Struct({ code: PluginErrorCode, message: Schema.optionalKey(Schema.String) })

export type PluginFailure = typeof PluginFailure.Type

// Window DIPs from the renderer, zoom applied. Background is RGBA with every channel 0-255; corners
// in that color mask the view's bottom edge to `radius`, redrawing the card's `border` ring along the arc.
const channel = Schema.Finite.check(Schema.isBetween({ minimum: 0, maximum: 255 }))

const rgba = Schema.Tuple([channel, channel, channel, channel])

export const PluginLayout = Schema.Struct({
  visible: Schema.Boolean,
  bounds: Schema.optionalKey(
    Schema.Struct({ x: Schema.Finite, y: Schema.Finite, width: Schema.Finite, height: Schema.Finite }),
  ),
  viewport: Schema.optionalKey(Schema.Struct({ width: Schema.Finite, height: Schema.Finite })),
  background: Schema.optionalKey(rgba),
  radius: Schema.optionalKey(Schema.Finite.check(Schema.isBetween({ minimum: 0, maximum: 100 }))),
  border: Schema.optionalKey(
    Schema.Struct({ color: rgba, width: Schema.Finite.check(Schema.isBetween({ minimum: 0, maximum: 10 })) }),
  ),
})

export const PluginEndpoint = Schema.Struct({
  id: text(16_384),
  url: text(16_384),
  password: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(4_096))),
})

export type PluginEndpoint = typeof PluginEndpoint.Type

export const PluginInstalled = Schema.Struct({
  id: Schema.String,
  builtin: Schema.Boolean,
  enabled: Schema.Boolean,
  error: Schema.optionalKey(Schema.String),
  server: Schema.optionalKey(Schema.Boolean),
  tui: Schema.optionalKey(Schema.Boolean),
  unsupported: Schema.optionalKey(Schema.Boolean),
})

export type PluginInstalled = typeof PluginInstalled.Type

export const PluginGuis = Schema.Struct({
  plugins: Schema.Array(
    Schema.Struct({
      id,
      revision: text(256),
      code: Schema.String,
      options: Schema.Record(Schema.String, Schema.Json),
    }),
  ),
  reserved: Schema.Array(id),
})

export type PluginGuis = typeof PluginGuis.Type

export const PluginMenubarItem = Schema.Struct({
  menu: Schema.String,
  id: Schema.String,
  label: Schema.String,
  after: Schema.optionalKey(Schema.String),
  enabled: Schema.Boolean,
})

export type PluginMenubarItem = typeof PluginMenubarItem.Type

export const PluginRpcs = RpcGroup.make(
  Rpc.make("PluginCall", {
    payload: { ipc: id, method: id, input: Schema.optionalKey(PluginPayload) },
    success: PluginPayload,
    error: PluginFailure,
  }),
  Rpc.make("PluginSubscribe", {
    payload: { ipc: id },
    success: Schema.Struct({ available: Schema.Boolean, state: Schema.optionalKey(PluginPayload) }),
  }),
  Rpc.make("PluginEmbed", { payload: { id, layout: Schema.optionalKey(PluginLayout) } }),
  Rpc.make("PluginCapture", { payload: { id }, success: Schema.NullOr(Transferable.Uint8Array) }),
  Rpc.make("PluginMenubarItem", { payload: { id } }),
  Rpc.make("PluginMenubarItems", { success: Schema.Array(PluginMenubarItem) }),
  Rpc.make("PluginConfigure", { payload: { servers: Schema.Array(PluginEndpoint) } }),
  // The plugin GUIs main lists from the app's own server; `PluginGuisChanged` brings each change.
  Rpc.make("PluginGuis", { success: PluginGuis }),
  Rpc.make("PluginList", { success: Schema.Array(PluginInstalled) }),
  Rpc.make("PluginEnable", { payload: { id }, error: PluginFailure }),
  Rpc.make("PluginDisable", { payload: { id }, error: PluginFailure }),
  Rpc.make("PluginReload", { payload: { id }, error: PluginFailure }),
)
