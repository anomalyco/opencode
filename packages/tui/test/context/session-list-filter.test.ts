import { describe, expect, test } from "bun:test"
import { createSessionListFilter } from "../../src/context/sync"

describe("session list filter", () => {
  test("uses the current exact directory when filtering is enabled", () => {
    expect(createSessionListFilter({ directoryFilterEnabled: true, directory: "/workspace/packages/tui" })).toEqual({
      directory: "/workspace/packages/tui",
    })
  })

  test("uses the project scope when directory filtering is disabled", () => {
    expect(createSessionListFilter({ directoryFilterEnabled: false, directory: "/workspace/packages/tui" })).toEqual({
      scope: "project",
    })
  })
})
