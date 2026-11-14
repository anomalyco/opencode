import { expect, test } from "bun:test"
import { addItem, chooseItem, menuTarget, removeItem, shownItems, updateItem, type MenuItem } from "./context-menus"

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
  // A parent must exist and must not sit under the item, or removing and drawing it would never end.
  expect(() => updateItem(items, "root", { parentId: "child" })).toThrow("descendant of itself")
  expect(() => updateItem(items, "root", { parentId: "root" })).toThrow("descendant of itself")
  expect(() => updateItem(items, "link", { parentId: "missing" })).toThrow("Cannot find menu item")
  expect(updateItem(items, "link", { parentId: "child" }).find((item) => item.id === "link")?.parentId).toBe("child")
})

test("choosing a checkbox flips it, and choosing a radio item turns off the others beside it", () => {
  const items = [
    { id: "box", type: "checkbox" as const },
    { id: "a", type: "radio" as const, checked: true },
    { id: "b", type: "radio" as const },
  ].reduce(addItem, [])

  const checked = (list: readonly MenuItem[]) => list.flatMap((item) => (item.checked ? [item.id] : []))

  const choose = (id: string) => {
    const item = items.find((entry) => entry.id === id)

    if (!item) throw new Error(`No item ${id}`)

    return checked(chooseItem(items, item))
  }

  expect(choose("box")).toEqual(["box", "a"])
  expect(choose("b")).toEqual(["b"])
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
