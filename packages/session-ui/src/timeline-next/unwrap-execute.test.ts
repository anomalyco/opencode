import { describe, expect, test } from "bun:test"
import { isServer } from "solid-js/web"
import { timelinePresets } from "../timeline/detail"
import { unwrapRuns } from "../timeline/unwrap-reactivity"
import { createNextTimelineProjection } from "./projection"

const detail = timelinePresets.find((item) => item.id === "detailed")!.value

// Solid's server build does not track, so this runs with `bun test --conditions=browser`.
describe.skipIf(isServer)("New timeline unwrapped script reactivity", () => {
  test("rebuilds only when a call starts or finishes", () => {
    expect(
      unwrapRuns(
        (messages, status) =>
          createNextTimelineProjection({
            sessionMessages: messages,
            status,
            timelineDetail: () => detail,
            unwrapExecute: true,
          }).rows,
      ),
    ).toEqual({ repeated: 0, added: 1, settled: 1 })
  })
})
