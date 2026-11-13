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
  expect(reveals({ permissions: [], hosts: ["https://example.com/*"] }, value.url)).toBe(true)
  expect(reveals({ permissions: ["storage"], hosts: ["https://other.com/*"] }, value.url)).toBe(false)
})

test("url and title filters reveal nothing about tabs the extension may not read", () => {
  const tabs = [tab({ id: 2, url: "https://mail.example.com/inbox", title: "Inbox (3)" }), tab({ id: 3, url: "https://docs.test/" })]
  const windows = { current: 1, lastFocused: 1 }
  const none: Parameters<typeof answerQuery>[3] = { permissions: [], hosts: [] }

  const ids = (query: Parameters<typeof matchesQuery>[1], access = none) =>
    answerQuery(tabs, query, windows, access).map((item) => item.id)

  // Without access the filters are ignored, as Chrome ignores them: every probe answers the same.
  expect(ids({ url: "https://mail.example.com/*" })).toEqual([2, 3])
  expect(ids({ url: "https://nothing.test/*" })).toEqual([2, 3])
  expect(ids({ title: "Inbox*" })).toEqual([2, 3])
  expect(answerQuery(tabs, {}, windows, none)[0]).not.toHaveProperty("url")
  // With host access to one site, the filters apply there.
  expect(ids({ url: "https://mail.example.com/*" }, { permissions: [], hosts: ["https://mail.example.com/*"] })).toEqual([
    2, 3,
  ])
  expect(ids({ url: "https://docs.test/*" }, { permissions: ["tabs"], hosts: [] })).toEqual([3])
})

test("Manifest V2 host patterns among permissions count as hosts", () => {
  expect(apiManifest({ manifest: { permissions: ["tabs", "<all_urls>", 7], host_permissions: ["https://a.com/*"] } })).toMatchObject({
    permissions: ["tabs", "<all_urls>"],
    hosts: ["https://a.com/*", "<all_urls>"],
  })
  expect(apiManifest({ manifest: "not a manifest" })).toMatchObject({ permissions: [], hosts: [], version: undefined })
})
