import { Schema } from "effect"
import { Rpc, RpcGroup } from "effect/unstable/rpc"
import { UpdaterStateSchema } from "./updater"
import { WslServersEventSchema } from "./wsl"

export class DeepLinksOpened extends Schema.TaggedClass<DeepLinksOpened>()("DeepLinksOpened", {
  urls: Schema.Array(Schema.String),
}) {}

export class MenuCommandTriggered extends Schema.TaggedClass<MenuCommandTriggered>()("MenuCommandTriggered", {
  id: Schema.String,
}) {}

export class UpdaterStateChanged extends Schema.TaggedClass<UpdaterStateChanged>()("UpdaterStateChanged", {
  state: UpdaterStateSchema,
}) {}

export class WslServersChanged extends Schema.TaggedClass<WslServersChanged>()("WslServersChanged", {
  event: WslServersEventSchema,
}) {}

export class WindowFullscreenChanged extends Schema.TaggedClass<WindowFullscreenChanged>()("WindowFullscreenChanged", {
  fullscreen: Schema.Boolean,
}) {}

export class WindowPinchZoomChanged extends Schema.TaggedClass<WindowPinchZoomChanged>()("WindowPinchZoomChanged", {
  enabled: Schema.Boolean,
}) {}

export class WindowZoomChanged extends Schema.TaggedClass<WindowZoomChanged>()("WindowZoomChanged", {
  factor: Schema.Number,
}) {}

export const DesktopEvent = Schema.Union([
  DeepLinksOpened,
  MenuCommandTriggered,
  UpdaterStateChanged,
  WslServersChanged,
  WindowFullscreenChanged,
  WindowPinchZoomChanged,
  WindowZoomChanged,
])
export type DesktopEvent = Schema.Schema.Type<typeof DesktopEvent>

export const DesktopEvents = Rpc.make("DesktopEvents", { success: DesktopEvent, stream: true })
export const EventRpcs = RpcGroup.make(DesktopEvents)
