import { describe, expect, test } from "bun:test"
import {
  HISTORY_TREE_AFTER,
  HISTORY_TREE_CARD_INSET,
  HISTORY_TREE_ICON,
  HISTORY_TREE_SIDEBAR_INSET,
  HISTORY_TREE_TITLE_PAD,
  MAC_TRAFFIC_LIGHTS_WIDTH,
  historyTreeChromeOnCard,
  historyTreeCollapsedStart,
  historyTreeTitlePadding,
  historyTreeTitleShift,
  historyTreeWindowChromeStart,
  historyTreeWindowToggle,
} from "./history-tree-chrome"

describe("history tree chrome", () => {
  test("collapsed start sits after traffic lights on mac and on the card inset elsewhere", () => {
    expect(historyTreeCollapsedStart(true)).toBe(MAC_TRAFFIC_LIGHTS_WIDTH)
    expect(historyTreeCollapsedStart(false)).toBe(HISTORY_TREE_CARD_INSET)
  })

  test("window chrome stays put in the title inset so toggling does not shift it", () => {
    expect(historyTreeWindowChromeStart(false)).toBe(HISTORY_TREE_CARD_INSET + HISTORY_TREE_TITLE_PAD)
    expect(historyTreeWindowChromeStart(true)).toBe(MAC_TRAFFIC_LIGHTS_WIDTH)
  })

  test("tree rows keep the same gutter when the header clears the traffic lights", () => {
    expect(HISTORY_TREE_SIDEBAR_INSET).toBe(historyTreeWindowChromeStart(false))
    expect(HISTORY_TREE_SIDEBAR_INSET).not.toBe(historyTreeWindowChromeStart(true))
  })

  test("chrome sits on the card when the tree is a drawer or collapsed", () => {
    expect(historyTreeChromeOnCard(true, true)).toBe(true)
    expect(historyTreeChromeOnCard(true, false)).toBe(true)
    expect(historyTreeChromeOnCard(false, true)).toBe(false)
    expect(historyTreeChromeOnCard(false, false)).toBe(true)
  })

  test("title shift lands after the in-window toggle", () => {
    const cluster = HISTORY_TREE_ICON + HISTORY_TREE_AFTER
    expect(HISTORY_TREE_CARD_INSET + HISTORY_TREE_TITLE_PAD + historyTreeTitleShift(false)).toBe(
      historyTreeWindowChromeStart(false) + cluster,
    )
    expect(HISTORY_TREE_CARD_INSET + HISTORY_TREE_TITLE_PAD + historyTreeTitleShift(true)).toBe(
      historyTreeWindowChromeStart(true) + cluster,
    )
    expect(historyTreeTitlePadding(false, false)).toBe(HISTORY_TREE_TITLE_PAD)
    expect(historyTreeTitlePadding(true, false)).toBe(HISTORY_TREE_TITLE_PAD + historyTreeTitleShift(false))
  })

  test("session title hosts the tree toggle on compact sessions, not a drawer menu", () => {
    expect(historyTreeWindowToggle({ mobile: true, treeOpened: false, session: true })).toBe(false)
    expect(historyTreeWindowToggle({ mobile: true, treeOpened: true, session: true })).toBe(false)
    expect(historyTreeWindowToggle({ mobile: true, treeOpened: false, session: false })).toBe(true)
    expect(historyTreeWindowToggle({ mobile: false, treeOpened: false, session: true })).toBe(true)
    expect(historyTreeWindowToggle({ mobile: false, treeOpened: true, session: true })).toBe(false)
  })
})
