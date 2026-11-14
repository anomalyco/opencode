import { expect, test } from "bun:test"
import { Browser } from "@opencode/plugin-browser/rpc"
import { Schema } from "effect"
import { PaneEvent, type Viewport } from "./ipc"
import { initialViewportToolbar, transitionViewportToolbar, viewportToolbarView } from "./viewport-toolbar-machine"

const target = { sessionKey: "alpha", tabID: Browser.TabID.make("tab_11111111-1111-1111-1111-111111111111") }

function page(viewport: Viewport, viewportNotice?: "failed" | "zoom") {
  const event = Schema.decodeUnknownSync(PaneEvent)({
    type: "page",
    tabID: target.tabID,
    zoom: 1,
    viewport,
    ...(viewportNotice && { viewportNotice }),
  })

  if (event.type !== "page") throw new Error("Expected a page report")

  return event
}

const fixed = { target, available: true, page: page({ mode: "fixed", width: 320, height: 700 }) }

test("rapid close, reopen, close keeps the final close when the earlier replies arrive last", () => {
  const toggle = { type: "toggled", context: fixed } as const
  const close = transitionViewportToolbar(initialViewportToolbar, toggle)
  const reopen = transitionViewportToolbar(close.state, toggle)
  const last = transitionViewportToolbar(reopen.state, toggle)
  expect([close.effect, reopen.effect, last.effect]).toEqual([
    { type: "toggle", open: false, attempt: 1, target },
    { type: "toggle", open: true, attempt: 2, target },
    { type: "toggle", open: false, attempt: 3, target },
  ])
  expect(transitionViewportToolbar(last.state, { type: "failed", attempt: 2, context: fixed })).toEqual({
    state: last.state,
  })
  const settled = transitionViewportToolbar(last.state, { type: "succeeded", attempt: 3 }).state
  expect(viewportToolbarView(settled, fixed).visible).toBe(false)
  expect(transitionViewportToolbar(settled, { type: "failed", attempt: 1, context: fixed })).toEqual({ state: settled })
})

test("closing or dismissing a notice hides only the report the user saw", () => {
  const context = { ...fixed, page: page(fixed.page.viewport, "failed") }
  const dismissed = transitionViewportToolbar(initialViewportToolbar, { type: "notice.dismissed", context })
  expect(viewportToolbarView(dismissed.state, context).notice).toBeUndefined()
  const close = transitionViewportToolbar(initialViewportToolbar, { type: "toggled", context })
  const reopen = transitionViewportToolbar(close.state, { type: "toggled", context })
  expect(viewportToolbarView(reopen.state, context).notice).toBeUndefined()
  expect(viewportToolbarView(reopen.state, { ...context, page: page(fixed.page.viewport, "failed") }).notice).toBe(
    "failed",
  )
})

test("a failed close follows the actual page size and only notifies the visit that requested it", () => {
  const close = transitionViewportToolbar(initialViewportToolbar, { type: "toggled", context: fixed })
  const failed = transitionViewportToolbar(close.state, { type: "failed", attempt: 1, context: fixed })
  expect(failed.effect).toEqual({ type: "notify-failed" })
  expect(viewportToolbarView(failed.state, fixed).visible).toBe(true)
  const back = { ...fixed, target: { ...target } }
  expect(transitionViewportToolbar(close.state, { type: "timeout", attempt: 1, context: back }).effect).toBeUndefined()
  const disposed = transitionViewportToolbar(close.state, { type: "disposed" }).state
  expect(transitionViewportToolbar(disposed, { type: "failed", attempt: 1, context: fixed })).toEqual({
    state: disposed,
  })
})
