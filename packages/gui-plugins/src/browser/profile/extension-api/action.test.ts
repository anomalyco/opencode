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

test("a popup sits under its button within Chrome's size limits and the window", () => {
  const anchor = { x: 900, y: 40, width: 32, height: 32 }
  const content = { width: 1000, height: 700 }

  expect(popupBounds(anchor, { width: 300, height: 400 }, content)).toEqual({ x: 632, y: 76, width: 300, height: 400 })
  expect(popupBounds(anchor, { width: 10, height: 10 }, content)).toEqual({ x: 907, y: 76, width: 25, height: 25 })
  expect(popupBounds(anchor, { width: 2000, height: 2000 }, content)).toEqual({ x: 132, y: 76, width: 800, height: 600 })
  expect(popupBounds({ x: 10, y: 40, width: 32, height: 32 }, { width: 300, height: 100 }, content).x).toBe(0)
})
