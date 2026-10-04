import { Schema } from "effect"
import { Rpc, RpcGroup } from "effect/unstable/rpc"
import { ExtensionInstalled, ExtensionMenubarItem, ExtensionPayload } from "./extensions"

export class DeepLinksOpened extends Schema.TaggedClass<DeepLinksOpened>()("DeepLinksOpened", {
  urls: Schema.Array(Schema.String),
}) {}

export class MenuCommandTriggered extends Schema.TaggedClass<MenuCommandTriggered>()("MenuCommandTriggered", {
  id: Schema.String,
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

// Another window wrote to a storage namespace; recipients refresh their in-memory copy.
export class StorageChanged extends Schema.TaggedClass<StorageChanged>()("StorageChanged", {
  name: Schema.String,
  insert: Schema.Record(Schema.String, Schema.String),
  remove: Schema.Array(Schema.String),
  revision: Schema.Number,
}) {}

// A main extension's Ipc state for this window, already encoded with the Ipc's schema.
export class ExtensionState extends Schema.TaggedClass<ExtensionState>()("ExtensionState", {
  ipc: Schema.String,
  state: ExtensionPayload,
}) {}

export class ExtensionEvent extends Schema.TaggedClass<ExtensionEvent>()("ExtensionEvent", {
  ipc: Schema.String,
  name: Schema.String,
  data: ExtensionPayload,
}) {}

export class ExtensionAvailable extends Schema.TaggedClass<ExtensionAvailable>()("ExtensionAvailable", {
  ipc: Schema.String,
  available: Schema.Boolean,
}) {}

export class ExtensionsChanged extends Schema.TaggedClass<ExtensionsChanged>()("ExtensionsChanged", {
  list: Schema.Array(ExtensionInstalled),
}) {}

export class ExtensionMenubarItemsChanged extends Schema.TaggedClass<ExtensionMenubarItemsChanged>()(
  "ExtensionMenubarItemsChanged",
  { items: Schema.Array(ExtensionMenubarItem) },
) {}

export const DesktopEvent = Schema.Union([
  DeepLinksOpened,
  MenuCommandTriggered,
  WindowFullscreenChanged,
  WindowPinchZoomChanged,
  WindowZoomChanged,
  StorageChanged,
  ExtensionState,
  ExtensionEvent,
  ExtensionAvailable,
  ExtensionsChanged,
  ExtensionMenubarItemsChanged,
])

export type DesktopEvent = Schema.Schema.Type<typeof DesktopEvent>

export const DesktopEvents = Rpc.make("DesktopEvents", { success: DesktopEvent, stream: true })

export const EventRpcs = RpcGroup.make(DesktopEvents)
