import { expect, test } from "bun:test"
import { Schema } from "effect"
import { Viewport } from "./ipc"
import { initialViewportControls, transitionViewportControls, viewportControlsView } from "./viewport-controls-machine"

const report = Schema.decodeUnknownSync(Viewport)

const context = { viewport: report({ mode: "auto" }), autoWidth: 600, autoHeight: 400, zoomed: false }

test("rotate and scale use the latest edit when the page reports an earlier size and replies arrive in reverse", () => {
  const edit = transitionViewportControls(initialViewportControls, {
    type: "edited",
    axis: "width",
    value: "820",
    context,
  })

  const rotate = transitionViewportControls(edit.state, { type: "rotated", context })
  const old = { ...context, viewport: report({ mode: "fixed", width: 820, height: 400 }) }
  const scaled = transitionViewportControls(rotate.state, { type: "scale.selected", scale: 0.5, context: old })

  expect(scaled.apply).toEqual({ attempt: 3, viewport: { mode: "fixed", width: 400, height: 820, scale: 0.5 } })
  expect(transitionViewportControls(scaled.state, { type: "failed", attempt: 2 }).state).toBe(scaled.state)
  const latest = transitionViewportControls(scaled.state, { type: "succeeded", attempt: 3, report: old.viewport }).state
  expect(transitionViewportControls(latest, { type: "succeeded", attempt: 1, report: old.viewport }).state).toBe(latest)
  expect(viewportControlsView(latest, old).fixed).toEqual({ mode: "fixed", width: 400, height: 820, scale: 0.5 })

  // Zoom or a later external resize wins even while the successful request is ahead of its report.
  expect(viewportControlsView(scaled.state, { ...context, zoomed: true }).fixed).toBeUndefined()
  const resized = report({ mode: "fixed", width: 900, height: 600 })
  expect(viewportControlsView(latest, { ...context, viewport: resized }).fields).toEqual({
    width: "900",
    height: "600",
  })
  const expired = transitionViewportControls(latest, { type: "timeout", attempt: 3 }).state
  expect(viewportControlsView(expired, old).fields).toEqual({ width: "820", height: "400" })
})

test("an incomplete edit keeps its own validation message across failure until focus leaves the pair", () => {
  const edit = transitionViewportControls(initialViewportControls, {
    type: "edited",
    axis: "height",
    value: "380",
    context,
  })

  const incomplete = transitionViewportControls(edit.state, { type: "edited", axis: "height", value: "", context })
  expect(incomplete.apply).toBeUndefined()
  const rejected = transitionViewportControls(incomplete.state, { type: "failed", attempt: 1 }).state
  expect(viewportControlsView(rejected, context)).toMatchObject({ error: false, invalid: true, fields: { height: "" } })
  const blurred = transitionViewportControls(rejected, { type: "blurred" }).state
  expect(viewportControlsView(blurred, context)).toMatchObject({
    error: false,
    invalid: false,
    fields: { height: "400" },
  })
})

test("a stalled apply releases the optimistic viewport; retry and disposal reject late replies", () => {
  const first = transitionViewportControls(initialViewportControls, { type: "scale.selected", scale: 0.5, context })
  const expired = transitionViewportControls(first.state, { type: "timeout", attempt: 1 }).state
  expect(viewportControlsView(expired, context)).toMatchObject({ fixed: undefined, error: true })
  const retry = transitionViewportControls(expired, { type: "scale.selected", scale: 0.75, context }).state
  expect(transitionViewportControls(retry, { type: "succeeded", attempt: 1, report: context.viewport }).state).toBe(
    retry,
  )
  expect(viewportControlsView(retry, context).error).toBe(false)
  const disposed = transitionViewportControls(retry, { type: "disposed" }).state
  expect(transitionViewportControls(disposed, { type: "failed", attempt: 2 }).state).toBe(disposed)
})
