import { beforeAll, describe, expect, mock, test } from "bun:test"
import { createRoot } from "solid-js"

let createBrowserStoreForTest: typeof import("./browser-store").createBrowserStoreForTest

beforeAll(async () => {
  mock.module("@opencode-ai/ui/context", () => ({
    createSimpleContext: () => ({
      use: () => undefined,
      provider: () => undefined,
    }),
  }))
  const mod = await import("./browser-store")
  createBrowserStoreForTest = mod.createBrowserStoreForTest
})

describe("browser store", () => {
  test("exposes the initially active browser memo", () => {
    createRoot((dispose) => {
      const browsers = createBrowserStoreForTest({
        activeId: "browser-1",
        instances: {
          "browser-1": { id: "browser-1", url: "https://opencode.ai", title: "opencode", visible: true },
        },
      })

      expect(browsers.activeBrowser()).toBe(browsers.store.instances["browser-1"])

      dispose()
    })
  })

  test("tracks panel state and active browser entries", () => {
    createRoot((dispose) => {
      const browsers = createBrowserStoreForTest()

      browsers.openPanel()
      expect(browsers.store.panelOpen).toBe(true)

      browsers.addBrowser("browser-1")
      expect(browsers.store.instances["browser-1"]).toEqual({
        id: "browser-1",
        url: "",
        title: "",
        visible: true,
      })
      expect(browsers.store.activeId).toBe("browser-1")

      browsers.updateBrowser("browser-1", { url: "https://opencode.ai", title: "opencode" })
      expect(browsers.store.instances["browser-1"]).toMatchObject({
        id: "browser-1",
        url: "https://opencode.ai",
        title: "opencode",
        visible: true,
      })

      browsers.closePanel()
      expect(browsers.store.panelOpen).toBe(false)

      dispose()
    })
  })

  test("makes newly added browsers active", () => {
    createRoot((dispose) => {
      const browsers = createBrowserStoreForTest()

      browsers.addBrowser("browser-1")
      browsers.addBrowser("browser-2")

      expect(browsers.store.activeId).toBe("browser-2")

      dispose()
    })
  })

  test("removes active browsers without using a stale fallback", () => {
    createRoot((dispose) => {
      const browsers = createBrowserStoreForTest()

      browsers.addBrowser("browser-1")
      browsers.addBrowser("browser-2")
      browsers.setActiveBrowser("browser-1")

      browsers.removeBrowser("browser-1")
      expect(browsers.store.instances["browser-1"]).toBeUndefined()
      expect(browsers.store.activeId).toBe("browser-2")

      browsers.removeBrowser("browser-2")
      expect(browsers.store.activeId).toBeNull()

      dispose()
    })
  })
})
