import { Schema } from "effect"
import { Rpc, RpcGroup } from "effect/unstable/rpc"

export const WindowGetId = Rpc.make("WindowGetId", { success: Schema.String })
export const WindowThemeReady = Rpc.make("WindowThemeReady")
export const WindowGetFocused = Rpc.make("WindowGetFocused", { success: Schema.Boolean })
export const WindowGetFullscreen = Rpc.make("WindowGetFullscreen", { success: Schema.Boolean })
export const WindowSetFocus = Rpc.make("WindowSetFocus")
export const WindowShow = Rpc.make("WindowShow")
export const WindowGetZoomFactor = Rpc.make("WindowGetZoomFactor", { success: Schema.Number })
export const WindowSetZoomFactor = Rpc.make("WindowSetZoomFactor", {
  payload: { factor: Schema.Number },
})
export const WindowGetPinchZoomEnabled = Rpc.make("WindowGetPinchZoomEnabled", {
  success: Schema.Boolean,
})
export const WindowSetPinchZoomEnabled = Rpc.make("WindowSetPinchZoomEnabled", {
  payload: { enabled: Schema.Boolean },
})
export const WindowSetTitlebar = Rpc.make("WindowSetTitlebar", {
  payload: {
    theme: Schema.Struct({
      mode: Schema.Literals(["light", "dark"]),
      scheme: Schema.optionalKey(Schema.Literals(["system", "light", "dark"])),
    }),
  },
})
export const WindowRpcs = RpcGroup.make(
  WindowGetId,
  WindowThemeReady,
  WindowGetFocused,
  WindowGetFullscreen,
  WindowSetFocus,
  WindowShow,
  WindowGetZoomFactor,
  WindowSetZoomFactor,
  WindowGetPinchZoomEnabled,
  WindowSetPinchZoomEnabled,
  WindowSetTitlebar,
)
