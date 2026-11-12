import { expect, test } from "bun:test"
import { addItem, menuTarget, removeItem, shownItems, updateItem } from "./context-menus"

const params = {
  linkURL: "",
  srcURL: "",
  mediaType: "none" as const,
  isEditable: false,
  selectionText: "",
  pageURL: "https://example.com/",
  frameURL: "",
}

test("items keep their tree, reject duplicate ids and unknown parents, and go with their parent", () => {
  const items = [
    { id: "root", title: "Root", contexts: ["all"] },
    { id: "child", title: "Search %s", parentId: "root" },
    { id: "link", title: "Open", contexts: ["link"], targetUrlPatterns: ["https://*.github.com/*"] },
  ].reduce(addItem, [])

  expect(() => addItem(items, { id: "root" })).toThrow("duplicate id root")
  expect(() => addItem(items, { id: "x", parentId: "missing" })).toThrow("Cannot find menu item")
  expect(updateItem(items, "child", { title: "Find %s" }).find((item) => item.id === "child")?.title).toBe("Find %s")
  expect(removeItem(items, "root").map((item) => item.id)).toEqual(["link"])
})

test("a right-click shows the items for what was clicked", () => {
  const items = [
    { id: "page", title: "Page" },
    { id: "selection", title: "Selection", contexts: ["selection"] },
    { id: "link", title: "Link", contexts: ["link"], targetUrlPatterns: ["https://*.github.com/*"] },
    { id: "only-docs", title: "Docs", contexts: ["all"], documentUrlPatterns: ["https://docs.example.com/*"] },
  ].reduce(addItem, [])

  expect(shownItems(items, menuTarget(params)).map((item) => item.id)).toEqual(["page"])
  expect(shownItems(items, menuTarget({ ...params, selectionText: "word" })).map((item) => item.id)).toEqual(["selection"])
  expect(shownItems(items, menuTarget({ ...params, linkURL: "https://github.com/x" })).map((item) => item.id)).toEqual(["link"])
  expect(shownItems(items, menuTarget({ ...params, linkURL: "https://gitlab.com/x" }))).toEqual([])
})
