import { expect, test } from "bun:test"
import { clampSessionPanelWidth } from "./session-panel-width"

test.each([
  ["keeps widths already within the limit", 800, 1700, false, false, 800],
  ["reserves the unified review pane minimum", 1600, 1700, false, false, 1220],
  ["reserves a larger minimum for split diffs", 1600, 1700, true, false, 900],
  // Regression: the old cap was 45% of the window, forcing the review pane to at least 55%.
  ["lets the chat panel take everything beyond the review pane minimum", 3440, 3440, false, false, 2960],
  ["holds the chat panel minimum when there is no room for both", 1600, 700, true, false, 450],
  ["never drops below the chat panel minimum on small windows", 1600, 0, false, false, 450],
  ["skips clamping before the layout is measured", 1600, undefined, false, false, 1600],
  ["lets a dragged width leave the side pane its hard minimum, split diffs included", 1600, 1700, true, true, 1380],
  ["keeps a dragged width below the default minimum", 320, 700, true, true, 320],
  ["never drops a dragged width below the hard chat minimum", 1600, 0, false, true, 320],
])("%s", (_name, width, available, split, resized, expected) => {
  expect(clampSessionPanelWidth({ width, available, split, resized })).toBe(expected)
})
