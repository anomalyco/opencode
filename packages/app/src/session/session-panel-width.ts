// The review pane has no width of its own: it takes whatever the chat panel
// leaves behind. Instead of capping the chat panel at a fraction of the window
// (which forces the review pane to grow with the monitor), reserve a fixed
// minimum for the review pane and let the chat panel take everything else.
// Until the user drags the divider, the default width keeps roomier minimums
// (wider still for split diffs); a drag can take either side down to the hard
// minimum. The chat minimum leaves the session header room for its title beside
// its controls, macOS traffic lights included.
export const SESSION_PANEL_WIDTH_MIN = 400

/** The one gap the pane row keeps between its panels; the CSS formulas below and the
 * consumers deriving a row width from it all read this constant. */
export const PANE_GAP = 8

const SIDE_PANE_WIDTH_MIN = 320

const SESSION_PANEL_WIDTH_FIT = 450

const REVIEW_PANE_WIDTH_FIT = 480

const REVIEW_PANE_WIDTH_FIT_SPLIT = 800

/** The trading dashboard's own floor on the row this module sizes: the desk's cards and
 * header need this much room — the review pane's 320 hard floor crushes them (Panic and
 * Connect already crowd together near 366). The trading chat passes it as `paneMin`, so
 * the pane the chat leaves behind never drops below it, dragged or not — one uniform cap
 * instead of the dragged-state drop to the side-pane minimum. */
export const TRADING_DASH_WIDTH_MIN = 480

/** The trading pane row's minimum with the chat open: the chat's hard floor, the pane gap,
 * and the dashboard's own floor. The shell caps the sidebar against this (plus the dash's
 * own side insets) so widening it can never crush the desk. */
export const TRADING_ROW_WIDTH_MIN = SESSION_PANEL_WIDTH_MIN + PANE_GAP + TRADING_DASH_WIDTH_MIN

export function sessionPanelWidthMax(input: { available: number; split: boolean; resized: boolean; paneMin?: number }) {
  if (input.resized) return Math.max(SESSION_PANEL_WIDTH_MIN, input.available - (input.paneMin ?? SIDE_PANE_WIDTH_MIN))
  const pane = input.split ? REVIEW_PANE_WIDTH_FIT_SPLIT : REVIEW_PANE_WIDTH_FIT

  return Math.max(SESSION_PANEL_WIDTH_FIT, input.available - pane)
}

// The same limit in CSS, against the pane row's width less its 8px gap, so the chat panel follows the row on the frame
// it resizes, e.g. while the left sidebar moves, rather than after a ResizeObserver callback.
export function sessionPanelWidthCss(input: { width: number; split: boolean; resized: boolean; paneMin?: number }) {
  const minimum = input.resized ? SESSION_PANEL_WIDTH_MIN : SESSION_PANEL_WIDTH_FIT
  const pane = input.paneMin ?? (input.resized ? SIDE_PANE_WIDTH_MIN : input.split ? REVIEW_PANE_WIDTH_FIT_SPLIT : REVIEW_PANE_WIDTH_FIT)

  // The outer floor raises a width stored below the minimum, e.g. dragged before it rose.
  return `max(${SESSION_PANEL_WIDTH_MIN}px, min(${input.width}px, max(${minimum}px, 100% - ${pane + PANE_GAP}px)))`
}

// `available` is undefined until the layout row is first measured; render the
// stored width untouched until then to avoid a first-frame snap.
export function clampSessionPanelWidth(input: {
  width: number
  available: number | undefined
  split: boolean
  resized: boolean
  paneMin?: number
}) {
  const width = Math.max(SESSION_PANEL_WIDTH_MIN, input.width)

  if (input.available === undefined) return width

  return Math.min(width, sessionPanelWidthMax({ ...input, available: input.available }))
}
