import { describe, expect, test } from "bun:test"
import { captureTabDragLayout, insertIndexFromVirtualLayout } from "./titlebar-tab-drag"
import { canOpenTabRename, createTabDragPreview, forwardTabRef, isTabCloseTarget } from "./titlebar-tab-gesture"

describe("titlebar tab drag", () => {
  const layout = {
    listLeft: 100,
    dividerWidth: 13,
    tabWidthById: new Map([
      ["a", 40],
      ["b", 40],
      ["c", 40],
      ["d", 40],
    ]),
  }

  test("moves across multiple tabs from one pointer update", () => {
    expect(insertIndexFromVirtualLayout(260, ["a", "b", "c", "d"], "a", 0, layout)).toBe(3)
    expect(insertIndexFromVirtualLayout(90, ["a", "b", "c", "d"], "d", 3, layout)).toBe(0)
  })

  test("keeps the current index inside the left hysteresis deadband", () => {
    expect(insertIndexFromVirtualLayout(146, ["a", "b", "c", "d"], "b", 1, layout)).toBe(1)
  })

  test("includes slot margins in captured divider width", () => {
    const list = document.createElement("div")
    const first = document.createElement("div")
    const second = document.createElement("div")
    const firstTab = document.createElement("div")
    const secondTab = document.createElement("div")
    first.dataset.titlebarTabSlot = ""
    first.dataset.tabKey = "a"
    second.dataset.titlebarTabSlot = ""
    second.dataset.tabKey = "b"
    second.style.marginLeft = "6px"
    firstTab.dataset.titlebarTab = ""
    secondTab.dataset.titlebarTab = ""
    first.append(firstTab)
    second.append(secondTab)
    list.append(first, second)
    document.body.append(list)
    firstTab.getBoundingClientRect = () => ({ width: 40 }) as DOMRect
    secondTab.getBoundingClientRect = () => ({ width: 40 }) as DOMRect
    second.getBoundingClientRect = () => ({ width: 47 }) as DOMRect
    list.getBoundingClientRect = () => ({ left: 100 }) as DOMRect

    expect(captureTabDragLayout(list, ["a", "b"]).dividerWidth).toBe(13)
    list.remove()
  })
})

describe("titlebar tab gestures", () => {
  test("excludes close controls from tab gestures", () => {
    const close = document.createElement("div")
    const button = document.createElement("button")
    const link = document.createElement("a")
    close.dataset.slot = "tab-close"
    close.append(button)
    expect(isTabCloseTarget(close)).toBe(true)
    expect(isTabCloseTarget(button)).toBe(true)
    expect(isTabCloseTarget(link)).toBe(false)
  })

  test("forwards component refs", () => {
    const element = document.createElement("div")
    let received: HTMLDivElement | undefined
    forwardTabRef((value) => (received = value), element)
    expect(received).toBe(element)
  })

  test("does not reopen rename while a save is pending", () => {
    expect(canOpenTabRename(false, false, false)).toBe(true)
    expect(canOpenTabRename(false, false, true)).toBe(false)
  })

  test("keeps the rendered tab content in the drag preview", () => {
    const tab = document.createElement("div")
    tab.innerHTML = '<span data-slot="project-avatar-slot"></span><span data-slot="tab-title">Session</span>'
    const preview = createTabDragPreview(tab)
    expect(preview.querySelector('[data-slot="project-avatar-slot"]')).not.toBeNull()
    expect(preview.querySelector('[data-slot="tab-title"]')?.textContent).toBe("Session")
  })
})
