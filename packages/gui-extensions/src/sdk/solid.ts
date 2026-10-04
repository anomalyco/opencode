import { createContext, useContext, type Accessor } from "solid-js"
import type { Context } from "./core"

/** The host provides this around every contribution it renders. */
export const ExtensionContext = createContext<Context>()

export function useExtension() {
  const context = useContext(ExtensionContext)
  if (!context) throw new Error("useExtension must run inside an extension contribution")
  return context
}

export interface PanelSidebar {
  opened(): boolean
  width(): number
  /** False until the stored width loads, so the first layout does not animate. */
  transition(): boolean
  resize(width: number): void
  toggle(): void
}

export interface PanelFrame {
  /** Region open and this tab selected. */
  readonly visible: Accessor<boolean>
  /** Kept on screen while the region animates closed. */
  readonly present: Accessor<boolean>
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

/** The host provides this around panel renders. */
export const PanelContext = createContext<PanelFrame>()

export function usePanel() {
  const frame = useContext(PanelContext)
  if (!frame) throw new Error("usePanel must run inside a panel render")
  return frame
}

/** The host provides this around a panel it shows in a narrow-screen drawer (`MobileView.kind` `"drawer"`). */
export const DrawerContext = createContext<{ readonly close: () => void }>()

/** The drawer showing this panel, or undefined outside one. Close it before an action that opens another view. */
export function useDrawer() {
  return useContext(DrawerContext)
}

/**
 * Runs fn when the main thread is idle (a short timeout where requestIdleCallback is missing, e.g. Safari). Returns a
 * cancel. Load lazy chunks this way from setup, so they are compiled before a session first opens.
 */
export function onIdle(fn: () => void) {
  if (typeof requestIdleCallback === "function") {
    const id = requestIdleCallback(fn)
    return () => cancelIdleCallback(id)
  }
  const id = setTimeout(fn, 200)
  return () => clearTimeout(id)
}
