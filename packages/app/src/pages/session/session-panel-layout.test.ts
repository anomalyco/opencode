import { describe, expect, test } from "bun:test"
import { sessionPanelLayout } from "./session-panel-layout"

describe("sessionPanelLayout", () => {
  test("keeps one V2 owner while changing panel geometry", () => {
    expect(sessionPanelLayout({ review: false, browser: false, terminal: false, files: false })).toEqual({
      visible: false,
      stacked: false,
    })
    expect(sessionPanelLayout({ review: false, browser: false, terminal: true, files: false })).toEqual({
      visible: true,
      stacked: false,
    })
    expect(sessionPanelLayout({ review: true, browser: false, terminal: true, files: false })).toEqual({
      visible: true,
      stacked: true,
    })
    expect(sessionPanelLayout({ review: false, browser: true, terminal: true, files: false })).toEqual({
      visible: true,
      stacked: true,
    })
  })
})
