import { createStore } from "solid-js/store"
import { SESSION_PANEL_WIDTH_FIT } from "@/session/session-panel-width"

// How a narrow desktop window shares its width. Panes yield in order rather than switching to the mobile layout: the
// side panel shrinks to its minimum, then the open left sidebar hides and floats when called, then the side panel
// becomes a sheet over the chat. None of it changes the saved preferences.
export const [room, setRoom] = createStore<{
  /** The narrowest the routed screen's content goes before the open sidebar gives way to it, set by the screen. */
  contentMinimum: number
  /** The width the shell's main row gives the routed screen and the docked sidebar together, set by the shell. */
  inner: number | undefined
  /** Whether the window is too narrow to dock the left sidebar, which then floats when called; set by the shell. */
  sidebarAutoHidden: boolean
}>({
  contentMinimum: SESSION_PANEL_WIDTH_FIT,
  inner: undefined,
  sidebarAutoHidden: false,
})

/** How far a width must cross a threshold back before the layout gives way again, so a resize doesn't flap at it. */
export const roomHysteresis = 16
