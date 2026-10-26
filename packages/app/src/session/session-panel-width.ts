// The review pane has no width of its own: it takes whatever the chat panel
// leaves behind. Instead of capping the chat panel at a fraction of the window
// (which forces the review pane to grow with the monitor), reserve a fixed
// minimum for the review pane and let the chat panel take everything else.
// Until the user drags the divider, the default width keeps roomier minimums
// (wider still for split diffs); a drag can take either side down to the hard
// minimum.
export const SESSION_PANEL_WIDTH_MIN = 320

const SIDE_PANE_WIDTH_MIN = 320

const SESSION_PANEL_WIDTH_FIT = 450

const REVIEW_PANE_WIDTH_FIT = 480

const REVIEW_PANE_WIDTH_FIT_SPLIT = 800

export function sessionPanelWidthMax(input: { available: number; split: boolean; resized: boolean }) {
  if (input.resized) return Math.max(SESSION_PANEL_WIDTH_MIN, input.available - SIDE_PANE_WIDTH_MIN)
  const pane = input.split ? REVIEW_PANE_WIDTH_FIT_SPLIT : REVIEW_PANE_WIDTH_FIT

  return Math.max(SESSION_PANEL_WIDTH_FIT, input.available - pane)
}

// The same limit in CSS, against the pane row's width less its 8px gap, so the chat panel follows the row on the frame
// it resizes, e.g. while the left sidebar moves, rather than after a ResizeObserver callback.
export function sessionPanelWidthCss(input: { width: number; split: boolean; resized: boolean }) {
  const minimum = input.resized ? SESSION_PANEL_WIDTH_MIN : SESSION_PANEL_WIDTH_FIT
  const pane = input.resized ? SIDE_PANE_WIDTH_MIN : input.split ? REVIEW_PANE_WIDTH_FIT_SPLIT : REVIEW_PANE_WIDTH_FIT

  return `min(${input.width}px, max(${minimum}px, 100% - ${pane + 8}px))`
}

// `available` is undefined until the layout row is first measured; render the
// stored width untouched until then to avoid a first-frame snap.
export function clampSessionPanelWidth(input: {
  width: number
  available: number | undefined
  split: boolean
  resized: boolean
}) {
  if (input.available === undefined) return input.width

  return Math.min(input.width, sessionPanelWidthMax({ ...input, available: input.available }))
}
