import { createContext, useContext, type Accessor } from "solid-js"
import type { Context, SetupContext } from "./context"
import type { Definition } from "./core"

/** The host provides this around every contribution it renders and in the extension's setup. Read it with `useExtension`. */
export const ExtensionContext = createContext<Context>()

/**
 * Marks a scope that ends before the extension does, such as a `createKeyed` run. The host disposes at once a
 * registration made in a scope that already ended. Host-internal.
 */
export const LifetimeContext = createContext<{
  /** The scope has ended. */
  readonly ended: boolean
}>()

/**
 * The extension's context inside a contribution: the same object setup receives. Pass the definition for the typed
 * declarations. Throws outside an extension contribution.
 *
 * @example
 * ```ts
 * function View() {
 *   const ctx = useExtension<typeof definition>()
 *   return <span>{ctx.stores.prefs.value.shown ? ctx.t("shown") : ctx.t("hidden")}</span>
 * }
 * ```
 */
export function useExtension<D extends Definition = never>() {
  const context = useContext(ExtensionContext)

  if (!context) throw new Error("useExtension must run inside an extension contribution")

  // SAFETY: the host's context for an extension also implements `SetupContext` of that extension's definition.
  return context as [D] extends [never] ? Context : SetupContext<D>
}

/** The inner sidebar preference every side panel shares, as `PanelFrame.sidebar`. */
export interface PanelSidebar {
  /** The inner sidebar is open. Reactive. */
  opened(): boolean
  /** Its width in CSS pixels. Reactive. */
  width(): number
  /** False until the stored width loads, so the first layout does not animate. */
  transition(): boolean
  /**
   * Stores a new width.
   *
   * @param width - The width in CSS pixels.
   */
  resize(width: number): void
  /** Opens or closes the inner sidebar. */
  toggle(): void
}

/** Where a panel render is shown. Read it with `usePanel`. */
export interface PanelFrame {
  /** Region open and this tab selected. */
  readonly visible: Accessor<boolean>
  /** Kept on screen while the region animates closed. */
  readonly present: Accessor<boolean>
  /**
   * Where the render is placed.
   * - `side`: the side region, or a dock beside the timeline.
   * - `bottom`: a dock stacked below the timeline.
   * - `mobile`: a narrow-screen view (`Panel.mobile`), or a dock embedded in one.
   */
  readonly placement: Accessor<"side" | "bottom" | "mobile">
  /** Leave room at the end of a header for the host's region toggle. */
  readonly reserve: Accessor<boolean>
  /** Plays size animations; false while the user drags a region edge. */
  readonly animate: Accessor<boolean>
  /** One inner sidebar preference shared by every side panel, toggled from the tab strip. */
  readonly sidebar: PanelSidebar
  /** This extension's tab ids stored in the session's side strip (the ids `list` receives as `open`). */
  readonly open: Accessor<readonly string[]>
}

/** The host provides this around panel renders. Read it with `usePanel`. */
export const PanelContext = createContext<PanelFrame>()

/**
 * Where the current panel render is shown. Throws outside a `Panel.render`.
 *
 * @example
 * ```ts
 * const panel = usePanel()
 * const compact = () => panel.placement() === "mobile"
 * ```
 */
export function usePanel() {
  const frame = useContext(PanelContext)

  if (!frame) throw new Error("usePanel must run inside a panel render")

  return frame
}

/** The host provides this around a panel it shows in a narrow-screen drawer (`MobileView.kind` `"drawer"`). */
export const DrawerContext = createContext<{
  /** Closes the drawer. */
  readonly close: () => void
}>()

/**
 * The drawer showing this panel, or undefined outside one. Close it before an action that opens another view.
 *
 * @example
 * ```ts
 * const drawer = useDrawer()
 * const open = (path: string) => {
 *   drawer?.close()
 *   ctx.layout.open(`file:${path}`, session)
 * }
 * ```
 */
export function useDrawer() {
  return useContext(DrawerContext)
}

/**
 * Runs fn when the main thread is idle (a short timeout where requestIdleCallback is missing, e.g. Safari). Load lazy
 * chunks this way from setup, so they are compiled before a session first opens.
 *
 * @param fn - The work to run.
 * @returns Cancels it if it has not run.
 *
 * @example
 * ```ts
 * const Page = lazy(() => import("./page"))
 * onCleanup(onIdle(() => void Page.preload()))
 * ```
 */
export function onIdle(fn: () => void) {
  if (typeof requestIdleCallback !== "undefined") {
    const id = requestIdleCallback(fn)

    return () => cancelIdleCallback(id)
  }

  const id = setTimeout(fn, 200)

  return () => clearTimeout(id)
}
