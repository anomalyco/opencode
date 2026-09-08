import { DesktopExtension } from "@opencode/plugin/desktop/protocol"
import { Schema } from "effect"
import { Rpc } from "effect/unstable/rpc"

export const ExtensionRequest = Schema.Union([
  Schema.Struct({ type: Schema.Literal("call"), call: DesktopExtension.Call }),
  Schema.Struct({ type: Schema.Literal("cancel"), extensionID: Schema.String, requestID: Schema.String }),
  Schema.Struct({ type: Schema.Literal("servers"), servers: Schema.Array(DesktopExtension.Endpoint) }),
  Schema.Struct({
    type: Schema.Literal("surface"),
    extensionID: Schema.String,
    surfaceID: Schema.String,
    layout: Schema.optionalKey(DesktopExtension.Layout),
  }),
  Schema.Struct({ type: Schema.Literal("release"), extensionID: Schema.String }),
])
export type ExtensionRequest = typeof ExtensionRequest.Type
export const ExtensionRpc = Rpc.make("DesktopExtension", {
  payload: { request: ExtensionRequest },
  success: Schema.Json,
})
