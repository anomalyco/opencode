import { beforeAll, expect, mock, test } from "bun:test"
import type { AsyncStorage } from "@solid-primitives/storage"
import { createEffect, createRoot } from "solid-js"
import type { Platform } from "@/runtime/platform/platform"
import type { ReviewPanelState } from "@/session/review/panel-state"

let createReviewPanelState: (platform?: Platform) => ReviewPanelState
let read: ((value: string | null) => void) | undefined

const storage: AsyncStorage = {
  getItem: () => new Promise((resolve) => (read = resolve)),
  setItem: async () => undefined,
  removeItem: async () => undefined,
  clear: async () => undefined,
  key: async () => null,
  getLength: async () => 0,
  length: Promise.resolve(0),
}

const platform: Platform = {
  platform: "desktop",
  storage: () => storage,
  openExternal: () => undefined,
  restart: async () => undefined,
  notify: async () => undefined,
  openDirectoryPickerDialog: async () => null,
}

beforeAll(async () => {
  mock.module("@opencode-ai/session-ui/v2/session-review-v2", () => ({
    SESSION_REVIEW_V2_SIDEBAR_WIDTH_DEFAULT: 240,
    SESSION_REVIEW_V2_SIDEBAR_WIDTH_MIN: 200,
    SESSION_REVIEW_V2_SIDEBAR_WIDTH_MAX: 480,
  }))

  createReviewPanelState = (await import("@/session/review/panel-state")).createReviewPanelState
})

test("enables sidebar motion only after custom width hydration", async () => {
  await new Promise<void>((resolve, reject) => {
    createRoot((dispose) => {
      const state = createReviewPanelState(platform)

      try {
        expect(state.sidebarTransition()).toBeFalse()
        expect(state.sidebarWidth()).toBe(240)
      } catch (error) {
        dispose()
        reject(error)
        return
      }

      createEffect(() => {
        if (!state.sidebarTransition()) return
        try {
          expect(state.sidebarWidth()).toBe(360)
          dispose()
          resolve()
        } catch (error) {
          dispose()
          reject(error)
        }
      })

      read?.(JSON.stringify({ sidebarOpened: true, sidebarWidth: 360, expandMode: "collapse" }))
    })
  })
})

test("recovers malformed preferences independently and keeps the filter transient", async () => {
  const root = createPanel()
  root.state.setFilter("transient")
  read?.(JSON.stringify({ sidebarOpened: false, sidebarWidth: "wide", expandMode: "invalid", filter: "stored" }))
  await root.ready
  expect(root.state.sidebarOpened()).toBeFalse()
  expect(root.state.sidebarWidth()).toBe(240)
  expect(root.state.expandMode()).toBe("collapse")
  expect(root.state.filter()).toBe("transient")
  root.dispose()
})

test.each([0, 199, 481, null])("rejects invalid persisted sidebar width %p", async (sidebarWidth) => {
  const root = createPanel()
  read?.(JSON.stringify({ sidebarWidth, expandMode: "expand" }))
  await root.ready
  expect(root.state.sidebarWidth()).toBe(240)
  expect(root.state.sidebarOpened()).toBeTrue()
  expect(root.state.expandMode()).toBe("expand")
  root.state.resizeSidebar(1000)
  expect(root.state.sidebarWidth()).toBe(480)
  root.state.resizeSidebar(0)
  expect(root.state.sidebarWidth()).toBe(200)
  root.dispose()
})

function createPanel() {
  return createRoot((dispose) => {
    const state = createReviewPanelState(platform)
    const ready = new Promise<void>((resolve) => {
      createEffect(() => {
        if (state.sidebarTransition()) resolve()
      })
    })
    return { dispose, state, ready }
  })
}
