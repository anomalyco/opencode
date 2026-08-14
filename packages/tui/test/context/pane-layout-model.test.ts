import { describe, expect, test } from "bun:test"
import type { GroupItem } from "@opencode-ai/client"
import {
  defaultPaneLayout,
  paneLayoutItems,
  reconcilePaneLayout,
  removePaneLayoutItem,
} from "../../src/context/pane-layout-model"

const session = (id: string): GroupItem => ({ type: "session", id })
const terminal = (id: string): GroupItem => ({ type: "terminal", id })

describe("pane layout model", () => {
  test("builds a master pane with an evenly divided right stack", () => {
    const items = [session("ses_1"), terminal("pty_1"), terminal("pty_2"), terminal("pty_3")]
    const layout = defaultPaneLayout(items)

    expect(layout).toEqual({
      type: "split",
      direction: "horizontal",
      ratio: 0.5,
      first: { type: "item", item: items[0] },
      second: {
        type: "split",
        direction: "vertical",
        ratio: 1 / 3,
        first: { type: "item", item: items[1] },
        second: {
          type: "split",
          direction: "vertical",
          ratio: 0.5,
          first: { type: "item", item: items[2] },
          second: { type: "item", item: items[3] },
        },
      },
    })
    expect(paneLayoutItems(layout!)).toEqual(items)
  })

  test("preserves stored split ratios when backend items still match", () => {
    const items = [session("ses_1"), terminal("pty_1")]
    const layout = defaultPaneLayout(items)!
    if (layout.type !== "split") throw new Error("Expected a split")
    layout.ratio = 0.65

    expect(reconcilePaneLayout(layout, items)).toMatchObject({ ratio: 0.65 })
  })

  test("rebuilds the default layout when backend order changes", () => {
    const items = [session("ses_1"), terminal("pty_1")]
    const layout = defaultPaneLayout(items)!
    if (layout.type !== "split") throw new Error("Expected a split")
    layout.ratio = 0.65

    expect(reconcilePaneLayout(layout, items.toReversed())).toMatchObject({ ratio: 0.5 })
  })

  test("removes a pane and preserves the remaining BSP layout", () => {
    const items = [session("ses_1"), terminal("pty_1"), terminal("pty_2")]
    const layout = defaultPaneLayout(items)!
    if (layout.type !== "split" || layout.second.type !== "split") throw new Error("Expected nested splits")
    layout.ratio = 0.65
    layout.second.ratio = 0.3

    expect(removePaneLayoutItem(layout, items[1])).toEqual({
      type: "split",
      direction: "horizontal",
      ratio: 0.65,
      first: { type: "item", item: items[0] },
      second: { type: "item", item: items[2] },
    })
  })
})
