// The window host's internals that the public SDK's helpers read. `gui/host` re-exports them for the hosts; the
// public `@opencode/plugin/gui` does not.

import { createContext, type Accessor, type JSX } from "solid-js"
import type { Context } from "./context.js"
import type { Live } from "./core.js"
import type { PanelFrame } from "./solid.js"

/** The host provides this around every contribution it renders and in the plugin's setup. `usePlugin` reads it. */
export const PluginContext = createContext<Context>()

/**
 * Marks a scope that ends before the plugin does, such as a `createKeyed` run. The host disposes at once a
 * registration made in a scope that already ended.
 */
export const LifetimeContext = createContext<{
  /** The scope has ended. */
  readonly ended: boolean
}>()

/** The host provides this around panel renders. `usePanel` reads it. */
export const PanelContext = createContext<PanelFrame>()

/** The host provides this around a panel it shows in a narrow-screen drawer (`MobileView.kind` `"drawer"`). */
export const DrawerContext = createContext<{
  /** Closes the drawer. */
  readonly close: () => void
  /** Shows content in place of the drawer's view, with a back control. */
  readonly open: (view: {
    /** The drawer's title while the content shows. */
    readonly title: string
    /** The content to show. */
    readonly content: JSX.Element
    /** The element that receives focus when the back control returns to the drawer's view. */
    readonly trigger: HTMLElement
  }) => void
}>()

const live = Symbol.for("opencode.plugin.live")

/**
 * Marks an accessor `ctx.use` returns, so `createKeyed` follows its generations.
 *
 * @param read - Returns the provider's current `Live` value, one object per transition.
 * @returns The same function, marked.
 */
export function liveAccessor<T>(read: () => Live<T>): Accessor<Live<T>> {
  return Object.assign(read, { [live]: true })
}

/**
 * Whether the host marked the accessor with `liveAccessor`.
 *
 * @param source - Any accessor.
 * @returns True for the accessors `ctx.use` returns.
 */
export function isLiveAccessor(source: Accessor<unknown>): source is Accessor<Live<unknown>> {
  return live in source
}
