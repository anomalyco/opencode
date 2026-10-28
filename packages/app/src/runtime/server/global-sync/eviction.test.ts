import { expect, test } from "bun:test"
import { canDisposeDirectory, pickDirectoriesToEvict } from "./eviction"

test("pickDirectoriesToEvict keeps pinned stores and evicts idle stores", () => {
  const picks = pickDirectoriesToEvict({
    stores: ["a", "b", "c", "d"],
    state: new Map([
      ["a", { lastAccessAt: 1_000 }],
      ["b", { lastAccessAt: 4_900 }],
      ["c", { lastAccessAt: 4_800 }],
      ["d", { lastAccessAt: 3_000 }],
    ]),
    pins: new Set(["a"]),
    max: 2,
    ttl: 1_500,
    now: 5_000,
  })

  expect(picks).toEqual(["d", "c"])
})

test.each([
  [{ pinned: true, booting: false, loadingSessions: false }, false],
  [{ pinned: false, booting: true, loadingSessions: false }, false],
  [{ pinned: false, booting: false, loadingSessions: true }, false],
  [{ pinned: false, booting: false, loadingSessions: false }, true],
])("canDisposeDirectory(%o) is %p", (state, expected) => {
  expect(canDisposeDirectory({ directory: "dir", hasStore: true, ...state })).toBe(expected)
})
