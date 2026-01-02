import { test, expect } from "bun:test"
import { register, getFooterItems, getSidebarItems, getAll, type StatusItem } from "../../src/status/registry"

test("register creates status item with initial render", () => {
  const handle = register({
    id: "test-status",
    priority: 10,
    render: {
      long: () => ({ icon: "🔍", text: "Test status", color: "green" }),
      short: () => ({ icon: "🔍", text: "Test", color: "green" }),
    },
  })

  expect(handle).toBeDefined()
  const all = getAll()
  expect(all).toHaveLength(1)
  expect(all[0].id).toBe("test-status")
  expect(all[0].priority).toBe(10)
})

test("register with priority default is 0", () => {
  register({
    id: "no-priority-status",
    render: {
      long: () => ({ text: "No priority" }),
      short: () => ({ text: "NoPrio" }),
    },
  })

  const all = getAll()
  const item = all.find((x) => x.id === "no-priority-status")
  expect(item?.priority).toBeUndefined()
})

test("getSidebarItems returns long format for all items", () => {
  register({
    id: "sidebar-test",
    render: {
      long: () => ({
        icon: "💾",
        text: "Sidebar item",
        detail: "Detail text",
        color: "blue",
      }),
    },
  })

  const sidebarItems = getSidebarItems()
  expect(sidebarItems.length).toBeGreaterThan(0)
  const sidebarItem = sidebarItems.find((x) => x.id === "sidebar-test")
  expect(sidebarItem).toBeDefined()
  expect(sidebarItem?.render.text).toBe("Sidebar item")
  expect(sidebarItem?.render.icon).toBe("💾")
  expect(sidebarItem?.render.detail).toBe("Detail text")
  expect(sidebarItem?.render.color).toBe("blue")
})

test("getFooterItems filters out items with null short format", () => {
  register({
    id: "no-short",
    render: {
      long: () => ({ text: "Only long format" }),
      short: () => null,
    },
  })

  const footerItems = getFooterItems()
  const noShortItem = footerItems.find((x) => x.id === "no-short")
  expect(noShortItem).toBeUndefined()

  const sidebarItems = getSidebarItems()
  const noShortSidebar = sidebarItems.find((x) => x.id === "no-short")
  expect(noShortSidebar).toBeDefined()
  expect(noShortSidebar?.render.text).toBe("Only long format")
})

test("getFooterItems returns items with short format", () => {
  register({
    id: "with-short",
    render: {
      long: () => ({ text: "Long format" }),
      short: () => ({ icon: "✅", text: "Short", color: "green" }),
    },
  })

  const footerItems = getFooterItems()
  const item = footerItems.find((x) => x.id === "with-short")
  expect(item).toBeDefined()
  expect(item?.render.text).toBe("Short")
  expect(item?.render.icon).toBe("✅")
  expect(item?.render.color).toBe("green")
})

test("update modifies long format", () => {
  const handle = register({
    id: "update-long",
    render: {
      long: () => ({ icon: "🔄", text: "Initial", color: "yellow" }),
    },
  })

  handle.update({
    long: { text: "Updated", icon: "✅", color: "green" },
  })

  const sidebarItems = getSidebarItems()
  const item = sidebarItems.find((x) => x.id === "update-long")
  expect(item?.render.text).toBe("Updated")
  expect(item?.render.icon).toBe("✅")
  expect(item?.render.color).toBe("green")
})

test("update partial long format merges with existing", () => {
  const handle = register({
    id: "partial-update",
    render: {
      long: () => ({ icon: "📊", text: "Original", detail: "Original detail", color: "default" }),
    },
  })

  handle.update({
    long: { text: "Updated text" },
  })

  const sidebarItems = getSidebarItems()
  const item = sidebarItems.find((x) => x.id === "partial-update")
  expect(item?.render.text).toBe("Updated text")
  expect(item?.render.icon).toBe("📊")
  expect(item?.render.detail).toBe("Original detail")
  expect(item?.render.color).toBe("default")
})

test("update sets short format to null", () => {
  const handle = register({
    id: "remove-short",
    render: {
      long: () => ({ text: "Long only" }),
      short: () => ({ text: "Has short" }),
    },
  })

  let footerItems = getFooterItems()
  expect(footerItems.find((x) => x.id === "remove-short")).toBeDefined()

  handle.update({
    short: null,
  })

  footerItems = getFooterItems()
  expect(footerItems.find((x) => x.id === "remove-short")).toBeUndefined()
})

test("update modifies short format", () => {
  const handle = register({
    id: "update-short",
    render: {
      long: () => ({ text: "Long" }),
      short: () => ({ icon: "⚠️", text: "Warning", color: "yellow" }),
    },
  })

  handle.update({
    short: { icon: "✅", text: "Success", color: "green" },
  })

  const footerItems = getFooterItems()
  const item = footerItems.find((x) => x.id === "update-short")
  expect(item?.render.text).toBe("Success")
  expect(item?.render.icon).toBe("✅")
  expect(item?.render.color).toBe("green")
})

test("update merges short format with existing", () => {
  const handle = register({
    id: "merge-short",
    render: {
      long: () => ({ text: "Long" }),
      short: () => ({ icon: "🔵", text: "Original", color: "blue" }),
    },
  })

  handle.update({
    short: { text: "Updated short" },
  })

  const footerItems = getFooterItems()
  const item = footerItems.find((x) => x.id === "merge-short")
  expect(item?.render.text).toBe("Updated short")
  expect(item?.render.icon).toBe("🔵")
  expect(item?.render.color).toBe("blue")
})

test("update both long and short simultaneously", () => {
  const handle = register({
    id: "update-both",
    render: {
      long: () => ({ icon: "🔴", text: "Initial long", detail: "Initial detail", color: "red" }),
      short: () => ({ icon: "🔴", text: "Init short", color: "red" }),
    },
  })

  handle.update({
    long: { text: "Updated long", color: "green" },
    short: { text: "Updated short", icon: "🟢" },
  })

  const sidebarItems = getSidebarItems()
  const sidebarItem = sidebarItems.find((x) => x.id === "update-both")
  expect(sidebarItem?.render.text).toBe("Updated long")
  expect(sidebarItem?.render.color).toBe("green")
  expect(sidebarItem?.render.detail).toBe("Initial detail")

  const footerItems = getFooterItems()
  const footerItem = footerItems.find((x) => x.id === "update-both")
  expect(footerItem?.render.text).toBe("Updated short")
  expect(footerItem?.render.icon).toBe("🟢")
})

test("remove deletes status item", () => {
  const handle = register({
    id: "to-remove",
    render: {
      long: () => ({ text: "Will be removed" }),
      short: () => ({ text: "Remove me" }),
    },
  })

  let all = getAll()
  expect(all.find((x) => x.id === "to-remove")).toBeDefined()

  handle.remove()

  all = getAll()
  expect(all.find((x) => x.id === "to-remove")).toBeUndefined()
})

test("remove after update works", () => {
  const handle = register({
    id: "remove-after-update",
    render: {
      long: () => ({ text: "Initial" }),
    },
  })

  handle.update({
    long: { text: "Updated" },
  })

  let items = getSidebarItems()
  expect(items.find((x) => x.id === "remove-after-update")?.render.text).toBe("Updated")

  handle.remove()

  items = getSidebarItems()
  expect(items.find((x) => x.id === "remove-after-update")).toBeUndefined()
})

test("multiple status items with different priorities", () => {
  register({ id: "prio-1", priority: 1, render: { long: () => ({ text: "1" }), short: () => ({ text: "1" }) } })
  register({ id: "prio-5", priority: 5, render: { long: () => ({ text: "5" }), short: () => ({ text: "5" }) } })
  register({ id: "prio-10", priority: 10, render: { long: () => ({ text: "10" }), short: () => ({ text: "10" }) } })

  const all = getAll()
  expect(all.length).toBeGreaterThanOrEqual(3)

  const sidebarItems = getSidebarItems()
  expect(sidebarItems.length).toBeGreaterThanOrEqual(3)

  const footerItems = getFooterItems()
  expect(footerItems.length).toBeGreaterThanOrEqual(3)
})

test("status item without icon works", () => {
  register({
    id: "no-icon",
    render: {
      long: () => ({ text: "No icon here", color: "gray" }),
      short: () => ({ text: "NoIcon", color: "gray" }),
    },
  })

  const sidebarItem = getSidebarItems().find((x) => x.id === "no-icon")
  expect(sidebarItem?.render.icon).toBeUndefined()
  expect(sidebarItem?.render.text).toBe("No icon here")

  const footerItem = getFooterItems().find((x) => x.id === "no-icon")
  expect(footerItem?.render.icon).toBeUndefined()
  expect(footerItem?.render.text).toBe("NoIcon")
})

test("status item with detail and progress in long format", () => {
  register({
    id: "rich-long",
    render: {
      long: () => ({
        icon: "📈",
        text: "Processing",
        detail: "Analyzing files...",
        progress: 45,
        color: "blue",
      }),
    },
  })

  const sidebarItem = getSidebarItems().find((x) => x.id === "rich-long")
  expect(sidebarItem?.render.detail).toBe("Analyzing files...")
  expect(sidebarItem?.render.progress).toBe(45)
})

test("status item with subtext in long format", () => {
  register({
    id: "with-subtext",
    render: {
      long: () => ({
        icon: "💾",
        text: "Auto-save",
        subtext: "Last saved: 2s ago",
        color: "green",
      }),
    },
  })

  const sidebarItem = getSidebarItems().find((x) => x.id === "with-subtext")
  expect(sidebarItem?.render.subtext).toBe("Last saved: 2s ago")
})
