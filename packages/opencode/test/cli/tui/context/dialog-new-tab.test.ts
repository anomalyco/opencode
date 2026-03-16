import { describe, expect, test, beforeEach } from "bun:test"
import { createRoot } from "solid-js"
import { createTabState, resetTabID } from "../../../../src/cli/cmd/tui/context/tab-state"

function mockKV() {
  const store: Record<string, any> = {}
  return {
    get(key: string, defaultValue?: any) {
      return store[key] ?? defaultValue
    },
    set(key: string, value: any) {
      store[key] = value
    },
    store,
  }
}

describe("DialogNewTab — single onConfirm invariant", () => {
  beforeEach(() => {
    resetTabID()
  })

  test("one onConfirm call creates exactly one tab", () => {
    createRoot((dispose) => {
      const state = createTabState(mockKV())
      expect(state.tabs()).toHaveLength(1)

      state.add({ sessionID: "ses_test", directory: "/tmp/wt", label: "feature-branch" })
      expect(state.tabs()).toHaveLength(2)

      dispose()
    })
  })

  test("two onConfirm calls create two tabs (documents the double-fire bug)", () => {
    createRoot((dispose) => {
      const state = createTabState(mockKV())
      expect(state.tabs()).toHaveLength(1)

      state.add({ sessionID: "ses_test", directory: "/tmp/wt", label: "feature-branch" })
      state.add({ sessionID: "ses_test", directory: "/tmp/wt", label: "feature-branch" })
      expect(state.tabs()).toHaveLength(3)

      dispose()
    })
  })
})
