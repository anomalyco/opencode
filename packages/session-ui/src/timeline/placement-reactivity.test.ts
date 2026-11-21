import { describe, expect, test } from "bun:test"
import { isServer } from "solid-js/web"
import { timelinePresets } from "./detail"
import { createReactiveTimelineProjection } from "./projection"
import { projectionRuns } from "./placement-reactivity"

const detail = timelinePresets.find((item) => item.id === "detailed")!.value

// Solid's server build does not track, so this runs with `bun test --conditions=browser`.
describe.skipIf(isServer)("current timeline placement reactivity", () => {
  test("does not rebuild its rows while calls stream or report progress", () => {
    const runs = projectionRuns(
      (messages, status) =>
        createReactiveTimelineProjection({
          sessionMessages: messages,
          status,
          reasoningMode: () => "full",
          timelineDetail: () => detail,
        }).rows,
    )

    expect(runs).toEqual({ streamed: 0, moved: 1, changed: [1, 1], scripted: 1 })
  })
})
