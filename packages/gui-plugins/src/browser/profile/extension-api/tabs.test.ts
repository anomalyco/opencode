import { expect, test } from "bun:test"
import { apiManifest } from "./manifest"
import { answerQuery, matchesQuery, reveals, tabInfo, type TabSnapshot } from "./tabs"

const tab = (fields: Partial<TabSnapshot>): TabSnapshot => ({
  id: 2,
  index: 0,
  windowId: 1,
  active: true,
  url: "https://example.com/",
  title: "Example",
  status: "complete",
  audible: false,
  muted: false,
  ...fields,
})

// A popup asks for "the current tab": the active tab of the window it opened over, not the popup itself.
test("the current tab is the active tab of the caller's window", () => {
  const tabs = [tab({ id: 2 }), tab({ id: 3, active: false }), tab({ id: 4, windowId: 7 })]
  const windows = { current: 1, lastFocused: 1 }

  const ids = (query: Parameters<typeof matchesQuery>[1]) =>
    tabs.flatMap((item) => (matchesQuery(item, query, windows) ? [item.id] : []))

  expect(ids({ active: true, currentWindow: true })).toEqual([2])
  expect(ids({ windowId: -2 })).toEqual([2, 3])
  expect(tabs.filter((item) => matchesQuery(item, { url: "*://example.com/*", title: "Ex*" }, windows)).length).toBe(3)
  expect(tabs.filter((item) => matchesQuery(item, { url: ["https://other.com/*"] }, windows))).toEqual([])
})

test("an extension sees a tab's address only with the tabs permission or host access", () => {
  const value = tab({})

  expect(tabInfo(value, false)).not.toHaveProperty("url")
  expect(tabInfo(value, true)).toMatchObject({ url: "https://example.com/", title: "Example" })
  expect(reveals({ permissions: ["tabs"], hosts: [] }, value.url)).toBe(true)
  const preview = tab({ url: "oc-preview://grant/work/index.html" })
  expect(tabInfo(preview, true)).not.toHaveProperty("url")
  expect(reveals({ permissions: ["tabs"], hosts: ["<all_urls>"] }, preview.url)).toBe(false)
  expect(reveals({ permissions: [], hosts: ["https://example.com/*"] }, value.url)).toBe(true)
  expect(reveals({ permissions: ["storage"], hosts: ["https://other.com/*"] }, value.url)).toBe(false)
})

test("filtered queries match only readable fields; non-sensitive filters still enumerate redacted tabs", () => {
  const tabs = [tab({ id: 1 }), tab({ id: 2, url: "https://other.test/" }), tab({ id: 3, url: "oc-preview://grant/report" })]
  const access = { permissions: [], hosts: ["https://example.com/*"] }

  for (const query of [{}, { active: true }, { windowId: 1 }]) {
    const result = answerQuery(tabs, query, {}, access)
    expect(result.map(t => t.id)).toEqual([1, 2, 3])

    for (const t of result.slice(1)) {
      for (const field of ["url", "title", "favIconUrl"]) expect(t).not.toHaveProperty(field)
    }
  }

  for (const query of [{ url: "<all_urls>" }, { url: ["https://example.com/*"] }, { title: "Ex*" }]) {
    expect(answerQuery(tabs, query, {}, access).map(t => t.id)).toEqual([1])
  }

  expect(answerQuery(tabs, { title: "No match" }, {}, access)).toEqual([])
})

test("Manifest V2 host patterns among permissions count as hosts", () => {
  expect(apiManifest({ manifest: { permissions: ["tabs", "<all_urls>", 7], host_permissions: ["https://a.com/*"] } })).toMatchObject({
    permissions: ["tabs", "<all_urls>"],
    hosts: ["https://a.com/*", "<all_urls>"],
  })
  expect(apiManifest({ manifest: "not a manifest" })).toMatchObject({ permissions: [], hosts: [], version: undefined })
})
