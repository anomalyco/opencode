import { expect, test } from "bun:test"
import { EventEmitter } from "node:events"
import type { Wire } from "./api"
import type { ExtensionTabs } from "./tabs"
import { createWebNavigation, fragmentOnly, frameIds } from "./web-navigation"

test("frames get Chrome's ids: 0 for the top frame, their tree node id below it", () => {
  const top = { frameTreeNodeId: 1, parent: null }
  const child = { frameTreeNodeId: 9, parent: top }
  const grandchild = { frameTreeNodeId: 12, parent: child }

  expect(frameIds(top, true)).toEqual({ frameId: 0, parentFrameId: -1 })
  expect(frameIds(child, false)).toEqual({ frameId: 9, parentFrameId: 0 })
  expect(frameIds(grandchild, false)).toEqual({ frameId: 12, parentFrameId: 9 })
})

test("an in-page navigation is a fragment change only when nothing but the fragment moved", () => {
  expect(fragmentOnly("https://a.com/x#one", "https://a.com/x#two")).toBe(true)
  expect(fragmentOnly("https://a.com/x", "https://a.com/y")).toBe(false)
  expect(fragmentOnly(undefined, "https://a.com/x#two")).toBe(false)
})

test("a load the page's beforeunload kept reports its error for the top frame instead of throwing", () => {
  let address = "https://a.example/form"

  // Electron's loadURL emits did-fail-load with no frame process or routing id when the page holds its unload.
  const contents = Object.assign(new EventEmitter(), {
    id: 7,
    isDestroyed: () => false,
    getURL: () => address,
  })

  const emitted: [string, readonly Wire[]][] = []

  // SAFETY: web navigation reads only `watch` and `get` of the tabs, and only the members above of a tab's contents.
  // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- see SAFETY above
  const tabs = {
    watch: (watch: (tab: { contents: typeof contents }) => (() => void) | void) => watch({ contents }) ?? (() => {}),
    get: () => undefined,
  } as unknown as ExtensionTabs

  createWebNavigation({ tabs, emit: (event, args) => emitted.push([event, args]) })

  contents.emit("did-fail-load", {}, -3, "ERR_ABORTED", "https://b.example/", true)
  address = "oc-preview://private/report"

  for (const url of ["https://b.example/", "data:text/html,ok", "about:srcdoc"]) {
    contents.emit("did-start-navigation", { url, isMainFrame: false })
    contents.emit("did-frame-navigate", {}, url, 200, "OK", false)
    contents.emit("did-navigate-in-page", {}, url, false)
    contents.emit("did-fail-load", {}, -3, "ERR_ABORTED", url, false)
  }

  expect(emitted).toEqual([
    [
      "webNavigation.onErrorOccurred",
      [
        {
          tabId: 7,
          processId: -1,
          timeStamp: expect.any(Number),
          frameId: 0,
          parentFrameId: -1,
          url: "https://b.example/",
          error: "ERR_ABORTED",
        },
      ],
    ],
  ])
})
