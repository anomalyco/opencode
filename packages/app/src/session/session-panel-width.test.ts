import { expect, test } from "bun:test"
import { clampSessionPanelWidth } from "./session-panel-width"

test.each([
  ["keeps widths already within the limit", 800, 1700, false, 800],
  ["reserves the unified review pane minimum", 1600, 1700, false, 1220],
  ["reserves a larger minimum for split diffs", 1600, 1700, true, 900],
  // Regression: the old cap was 45% of the window, forcing the review pane to at least 55%.
  ["lets the chat panel take everything beyond the review pane minimum", 3440, 3440, false, 2960],
  ["holds the chat panel minimum when there is no room for both", 1600, 700, true, 450],
  ["never drops below the chat panel minimum on small windows", 1600, 0, false, 450],
  ["skips clamping before the layout is measured", 1600, undefined, false, 1600],
])("%s", (_name, width, available, split, expected) => {
  expect(clampSessionPanelWidth({ width, available, split })).toBe(expected)
})
