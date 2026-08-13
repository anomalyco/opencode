import { describe, expect, test } from "bun:test"
import { searchLifecycleFlow } from "../scenarios/tools/search-lifecycle"
import { webLifecycleFlow } from "../scenarios/tools/web-lifecycle"

describe("search and web executable flows", () => {
  test("exports project search states in execution order", () => {
    expect(searchLifecycleFlow.states.map((state) => state.address)).toEqual([
      "search-lifecycle/glob-success",
      "search-lifecycle/glob-empty",
      "search-lifecycle/grouped-exploration",
      "search-lifecycle/grep-success",
      "search-lifecycle/grep-empty",
      "search-lifecycle/grep-failure",
    ])
  })

  test("exports renderer-specific web states", () => {
    expect(webLifecycleFlow.states.map((state) => state.address)).toEqual([
      "web-lifecycle/webfetch-streaming",
      "web-lifecycle/webfetch-success",
      "web-lifecycle/websearch-running",
      "web-lifecycle/websearch-failure",
    ])
  })
})
