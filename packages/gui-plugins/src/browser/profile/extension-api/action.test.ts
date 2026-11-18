import { expect, test } from "bun:test"
import { actionFor, badgeColor, initialAction, setAction } from "./action"
import { extensionPage } from "../extensions"
import { popupBounds } from "./popup"

test("a tab's own values sit over the values for every tab", () => {
  const state = [
    { values: { title: "Blocker", badgeText: "", popup: "popup.html" } },
    { values: { badgeText: "12" }, tab: 4 },
    { values: { popup: "" }, tab: 5 },
  ].reduce((current, step) => setAction(current, step.values, step.tab), initialAction)

  expect(actionFor(state, 4)).toEqual({ title: "Blocker", badgeText: "12", popup: "popup.html" })
  expect(actionFor(state, 5).popup).toBe("")
  expect(actionFor(state)).toEqual({ title: "Blocker", badgeText: "", popup: "popup.html" })
  expect(badgeColor([255, 0, 0, 255])).toBe("rgba(255, 0, 0, 1)")
  expect(badgeColor("#00f")).toBe("#00f")
})

test("a popup or options page is always a page of the extension's own package", () => {
  const id = "nngceckbapebfimnlniiiahkandclblb"
  const own = (file: string) => `chrome-extension://${id}/${file}`

  expect(
    [
      "popup.html",
      "/popup/index.html?x=1",
      "https://evil.example/login",
      "//evil.example/login",
      "\\\\evil.example\\login",
      "chrome-extension://aaaabbbbccccddddeeeeffffgggghhhh/popup.html",
      "../../popup.html",
      "",
      undefined,
    ].map((file) => extensionPage(id, file)),
  ).toEqual([
    own("popup.html"),
    own("popup/index.html?x=1"),
    own("https://evil.example/login"),
    own("evil.example/login"),
    own("evil.example\\login"),
    own("chrome-extension://aaaabbbbccccddddeeeeffffgggghhhh/popup.html"),
    own("popup.html"),
    undefined,
    undefined,
  ])
})

test("a popup starts at the page area's top with its right edge on its button's, within Chrome's size limits and the window", () => {
  // The button ends 6 px above the page area: the toolbar's own inset, which the popup does not copy.
  const placement = { anchor: { x: 900, y: 40, width: 32, height: 32 }, top: 78 }
  const content = { width: 1000, height: 700 }

  expect(popupBounds(placement, { width: 300, height: 400 }, content)).toEqual({ x: 632, y: 78, width: 300, height: 400 })
  expect(popupBounds(placement, { width: 10, height: 10 }, content)).toEqual({ x: 907, y: 78, width: 25, height: 25 })
  expect(popupBounds(placement, { width: 2000, height: 2000 }, content)).toEqual({ x: 132, y: 78, width: 800, height: 600 })
  // Under a notice or find bar the page area starts lower, and so does the popup.
  expect(popupBounds({ ...placement, top: 122 }, { width: 300, height: 400 }, content).y).toBe(122)
  // One that would not fit below moves up to stay inside the window.
  expect(popupBounds({ ...placement, top: 400 }, { width: 300, height: 400 }, content).y).toBe(300)
  expect(popupBounds({ anchor: { x: 10, y: 40, width: 32, height: 32 }, top: 78 }, { width: 300, height: 100 }, content).x).toBe(0)
})

test("a popup opens from the end of the toolbar: right edge on the button's, or left edge on it right to left", () => {
  const content = { width: 1000, height: 700 }
  const size = { width: 300, height: 400 }
  const at = (x: number, rtl: boolean) => popupBounds({ anchor: { x, y: 40, width: 32, height: 32 }, top: 78, rtl }, size, content).x

  // [the button's left edge, the popup's left edge left to right, and right to left]
  for (const [x, ltr, rtl] of [
    [900, 632, 700],
    [40, 0, 40],
    // Moved to fit: no room to the left of a button near the left edge, nor to the right of one near the right edge.
    [200, 0, 200],
    [760, 492, 700],
    [968, 700, 700],
  ] as const) {
    expect(`${x} ltr ${at(x, false)}`).toBe(`${x} ltr ${ltr}`)
    expect(`${x} rtl ${at(x, true)}`).toBe(`${x} rtl ${rtl}`)
  }
})

test("nothing the window reports puts a popup over the app's bars or outside the window", () => {
  const content = { width: 1200, height: 800 }
  const anchor = { x: 1100, y: 40, width: 32, height: 32 }
  const size = { width: 400, height: 500 }
  const honest = { x: 732, y: 78, width: 400, height: 500 }
  expect(popupBounds({ anchor, top: 78, pageTop: 78 }, size, content)).toEqual(honest)

  // Main's own page top is the floor while the page fills the page area: the window's number can only lower the popup.
  for (const top of [0, -40, -100_000, Number.NaN, Number.NEGATIVE_INFINITY, Number.POSITIVE_INFINITY, 77])
    expect(popupBounds({ anchor, top, pageTop: 78 }, size, content)).toEqual(honest)
  expect(popupBounds({ anchor, top: 122, pageTop: 78 }, size, content).y).toBe(122)

  // With a device viewport main has no page top: the popup still never starts above the bottom edge of its button.
  for (const top of [0, -40, Number.NaN, Number.NEGATIVE_INFINITY]) expect(popupBounds({ anchor, top }, size, content).y).toBe(72)

  // A top below the window, or one that leaves no room, keeps the popup inside it and under the floor.
  for (const top of [1e308, 5_000]) expect(popupBounds({ anchor, top, pageTop: 78 }, size, content)).toEqual({ ...honest, y: 300 })
  expect(popupBounds({ anchor, top: 78, pageTop: 78 }, { width: 400, height: 600 }, { width: 1200, height: 500 })).toEqual({ x: 732, y: 78, width: 400, height: 422 })

  // A button that is nowhere, or outside the content, counts as at its edge.
  for (const wrong of [
    { x: Number.NaN, y: 0, width: Number.NaN, height: 0 },
    { ...anchor, x: Number.NEGATIVE_INFINITY },
    { x: -5_000, y: -5_000, width: 10, height: 10 },
    { x: 5_000, y: 5_000, width: 10, height: 10 },
  ]) {
    const bounds = popupBounds({ anchor: wrong, top: 78, pageTop: 78 }, size, content)
    expect(Object.values(bounds).every(Number.isInteger)).toBe(true)
    expect(bounds.x >= 0 && bounds.x + bounds.width <= content.width).toBe(true)
    expect(bounds.y >= 78 && bounds.y + bounds.height <= content.height).toBe(true)
  }
})
