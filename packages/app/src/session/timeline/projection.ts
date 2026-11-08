import { createReactiveTimelineProjection } from "@Mackery6969/session-ui/timeline/projection"

export { reuseTimelineRows } from "@Mackery6969/session-ui/timeline/projection"

export function createTimelineProjection(input: Parameters<typeof createReactiveTimelineProjection>[0]) {
  return createReactiveTimelineProjection(input)
}
