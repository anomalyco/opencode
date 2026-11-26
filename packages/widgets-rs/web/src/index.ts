// widget-web: PsychoScript widgets in the browser (specs/v2/widgets.md, widgets-live.md, widgets-fullscreen.md).
//
//   import { mount } from "widget-web"
//   const widget = mount(element, { program, data, mode, capabilities, state, onSubmit, onDismiss, onSend, theme })
//   widget.setState("submitted"); widget.destroy()

import type { HostOptions, MountOptions, MountedWidget } from "./host.js"
import { WidgetHost } from "./host.js"

export { WidgetHost }
export type { Capabilities, HostOptions, Labels, MountOptions, MountedWidget, WidgetStatus } from "./host.js"
export type { Theme, ThemeTokens } from "./theme.js"
export { DARK, LIGHT } from "./theme.js"
export type { Frame, ViewNode, WidgetEvent } from "./protocol.js"

let shared: WidgetHost | undefined

/** Configures the page's shared host (asset URLs); call before the first `mount`. */
export function configure(options: HostOptions): WidgetHost {
  shared?.destroy()
  shared = new WidgetHost(options)
  return shared
}

/** The page's shared host. */
export function host(): WidgetHost {
  shared ??= new WidgetHost()
  return shared
}

/** Mounts a widget into `el` (appends a child element with a shadow root) with the page's shared host. */
export function mount(el: HTMLElement, options: MountOptions): MountedWidget {
  return host().mount(el, options)
}
