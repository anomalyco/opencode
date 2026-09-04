import { describe, expect, test } from "bun:test"
import { compareModels, isFreeModel } from "./order"

describe("model ordering", () => {
  test("orders free first, then newest release, then name", () => {
    const items = [
      { name: "A paid new", release_date: "2026-09-01", cost: { input: 1 } },
      { name: "A free old", release_date: "2026-01-01", cost: { input: 0 } },
      { name: "Z free new", release_date: "2026-08-01", cost: { input: 0 } },
      { name: "A free new", release_date: "2026-08-01", cost: { input: 0 } },
      { name: "A paid old", release_date: "2026-01-01", cost: { input: 1 } },
    ].map((item) => ({ ...item, provider: { id: "opencode" } }))

    expect(items.toSorted(compareModels).map((item) => item.name)).toEqual([
      "A free new",
      "Z free new",
      "A free old",
      "A paid new",
      "A paid old",
    ])
  })

  test("uses the existing free badge predicate, not zero cost on other providers", () => {
    expect(isFreeModel({ provider: { id: "opencode" } })).toBe(true)
    expect(isFreeModel({ provider: { id: "opencode" }, cost: { input: 0 } })).toBe(true)
    expect(isFreeModel({ provider: { id: "opencode" }, cost: { input: 1 } })).toBe(false)
    expect(isFreeModel({ provider: { id: "opencode-go" }, cost: { input: 0 } })).toBe(false)
    expect(isFreeModel({ provider: { id: "custom" } })).toBe(false)

    const free = { provider: { id: "opencode" }, name: "Z missing cost", release_date: "2026-01-01" }
    const other = { provider: { id: "custom" }, name: "A zero cost", release_date: "2026-09-01", cost: { input: 0 } }
    expect([other, free].sort(compareModels)).toEqual([free, other])
  })

  test("sorts missing and invalid release dates last with a name tie-breaker", () => {
    const items = [
      { name: "B missing" },
      { name: "C empty", release_date: "" },
      { name: "A invalid", release_date: "not-a-date" },
      { name: "Z dated", release_date: "2026-01-01" },
    ].map((item) => ({ ...item, provider: { id: "opencode" } }))

    expect(items.sort(compareModels).map((item) => item.name)).toEqual(["Z dated", "A invalid", "B missing", "C empty"])
  })

  test("compares parsed instants rather than release date strings", () => {
    const older = { provider: { id: "custom" }, name: "A", release_date: "2026-08-02T00:00:00+10:00" }
    const newer = { provider: { id: "custom" }, name: "Z", release_date: "2026-08-01T20:00:00Z" }
    expect([older, newer].sort(compareModels)).toEqual([newer, older])
  })
})
