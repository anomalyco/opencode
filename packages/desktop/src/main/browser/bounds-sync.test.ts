import { describe, expect, test } from "bun:test"

import { attachAndShow, syncViewBounds } from "./bounds-sync"

function createView() {
  return {
    bounds: { x: 0, y: 0, width: 0, height: 0 },
    visible: false,
    setBounds(bounds: { x: number; y: number; width: number; height: number }) {
      this.bounds = bounds
    },
    setVisible(visible: boolean) {
      this.visible = visible
    },
  }
}

function createWindow() {
  const children: unknown[] = []
  return {
    contentView: {
      children,
      addChildView(view: unknown) {
        children.push(view)
      },
    },
  }
}

describe("bounds sync", () => {
  test("syncs WebContentsView bounds and makes the view visible", () => {
    const win = createWindow()
    const view = createView()

    syncViewBounds(win as never, view as never, { x: 10, y: 20, width: 300, height: 200 })

    expect(view.bounds).toEqual({ x: 10, y: 20, width: 300, height: 200 })
    expect(view.visible).toBe(true)
    expect(win.contentView.children).toEqual([])
  })

  test("attaches a view once before syncing and showing it", () => {
    const win = createWindow()
    const view = createView()

    attachAndShow(win as never, view as never, { x: 1, y: 2, width: 640, height: 360 })
    attachAndShow(win as never, view as never, { x: 3, y: 4, width: 800, height: 450 })

    expect(win.contentView.children).toEqual([view])
    expect(view.bounds).toEqual({ x: 3, y: 4, width: 800, height: 450 })
    expect(view.visible).toBe(true)
  })
})
