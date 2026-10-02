import { Schema } from "effect"
import { Rpc, RpcGroup } from "effect/rpc"
import { Transferable } from "effect/workers"

const text = (maximum: number) => Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(maximum))
const id = text(256)

// Remote payloads are already encoded by the extension's own schemas and cross by structured
// clone, so the JSON codec passes them through untouched, bytes included. Encoded values must be
// JSON values or Uint8Arrays: the renderer drops undefined keys the way JSON would.
export const ExtensionPayload = Schema.declare((_: unknown): _ is unknown => true, { toCodecJson: () => undefined })

export const ExtensionErrorCode = Schema.Literals([
  // Calls into a main extension's remote.
  "unavailable",
  "method",
  "input",
  "output",
  "failed",
  // The extension manager.
  "notFound",
  "builtin",
  "reserved",
  "invalidArchive",
  "invalidManifest",
  "invalidPath",
  "invalidModule",
  "tooLarge",
  "download",
  "url",
])
export type ExtensionErrorCode = typeof ExtensionErrorCode.Type

export const ExtensionFailure = Schema.Struct({ code: ExtensionErrorCode, message: Schema.optionalKey(Schema.String) })
export type ExtensionFailure = typeof ExtensionFailure.Type

// Window DIPs from the renderer, zoom applied. Background is RGBA with every channel 0-255; corners
// in that color mask the view's bottom edge to `radius`.
const channel = Schema.Finite.check(Schema.isBetween({ minimum: 0, maximum: 255 }))
export const ExtensionLayout = Schema.Struct({
  visible: Schema.Boolean,
  bounds: Schema.optionalKey(
    Schema.Struct({ x: Schema.Finite, y: Schema.Finite, width: Schema.Finite, height: Schema.Finite }),
  ),
  background: Schema.optionalKey(Schema.Tuple([channel, channel, channel, channel])),
  radius: Schema.optionalKey(Schema.Finite.check(Schema.isBetween({ minimum: 0, maximum: 100 }))),
})

export const ExtensionEndpoint = Schema.Struct({
  id: text(16_384),
  url: text(16_384),
  username: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(1_024))),
  password: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(4_096))),
})
export type ExtensionEndpoint = typeof ExtensionEndpoint.Type

export const ExtensionInstalled = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  version: Schema.String,
  builtin: Schema.Boolean,
  enabled: Schema.Boolean,
  revision: Schema.optionalKey(Schema.String),
  error: Schema.optionalKey(Schema.String),
})
export type ExtensionInstalled = typeof ExtensionInstalled.Type

export const ExtensionMenubarItem = Schema.Struct({
  menu: Schema.String,
  id: Schema.String,
  label: Schema.String,
  after: Schema.optionalKey(Schema.String),
  enabled: Schema.Boolean,
})
export type ExtensionMenubarItem = typeof ExtensionMenubarItem.Type

export const ExtensionRpcs = RpcGroup.make(
  Rpc.make("ExtensionCall", {
    payload: { remote: id, method: id, input: Schema.optionalKey(ExtensionPayload) },
    success: ExtensionPayload,
    error: ExtensionFailure,
  }),
  Rpc.make("ExtensionSubscribe", {
    payload: { remote: id },
    success: Schema.Struct({ available: Schema.Boolean, state: Schema.optionalKey(ExtensionPayload) }),
  }),
  Rpc.make("ExtensionSurface", { payload: { id, layout: Schema.optionalKey(ExtensionLayout) } }),
  Rpc.make("ExtensionCapture", { payload: { id }, success: Schema.NullOr(Transferable.Uint8Array) }),
  Rpc.make("ExtensionMenubar", { payload: { id } }),
  Rpc.make("ExtensionMenubarItems", { success: Schema.Array(ExtensionMenubarItem) }),
  Rpc.make("ExtensionConfigure", { payload: { servers: Schema.Array(ExtensionEndpoint) } }),
  Rpc.make("ExtensionList", { success: Schema.Array(ExtensionInstalled) }),
  Rpc.make("ExtensionEnable", { payload: { id }, error: ExtensionFailure }),
  Rpc.make("ExtensionDisable", { payload: { id }, error: ExtensionFailure }),
  Rpc.make("ExtensionReload", { payload: { id }, error: ExtensionFailure }),
  Rpc.make("ExtensionInstall", {
    payload: { source: Schema.Union([Transferable.Uint8Array, text(16_384)]) },
    error: ExtensionFailure,
  }),
  Rpc.make("ExtensionRemove", { payload: { id }, error: ExtensionFailure }),
  Rpc.make("ExtensionSource", { payload: { id }, success: Schema.String, error: ExtensionFailure }),
)
