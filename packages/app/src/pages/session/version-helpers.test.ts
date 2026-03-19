import { describe, expect, test } from "bun:test"
import { hasSessionChanges, sameVersionItems } from "./version-helpers"

const session = (overrides?: Partial<{ id: string; title: string; updated: number; number: number; latestID: string }>) => ({
  id: overrides?.id ?? "ses_1",
  title: overrides?.title ?? "Session",
  parentID: undefined,
  time: {
    created: 1,
    updated: overrides?.updated ?? 2,
  },
  lineage: {
    number: overrides?.number ?? 1,
    latestID: overrides?.latestID ?? "ses_1",
    rootID: "ses_1",
  },
})

describe("sameVersionItems", () => {
  test("returns true for identical ordered version lists", () => {
    const items = [session(), session({ id: "ses_2", updated: 3, number: 2, latestID: "ses_2" })]
    expect(sameVersionItems(items, items.map((item) => ({ ...item, time: { ...item.time }, lineage: { ...item.lineage } })))).toBe(
      true,
    )
  })

  test("returns false when version metadata changes", () => {
    expect(sameVersionItems([session()], [session({ updated: 3 })])).toBe(false)
  })
})

describe("hasSessionChanges", () => {
  test("returns false when incoming sessions match stored sessions", () => {
    const items = [session(), session({ id: "ses_2", updated: 3, number: 2, latestID: "ses_2" })]
    expect(hasSessionChanges(items, items)).toBe(false)
  })

  test("returns true when a session is new or updated", () => {
    expect(hasSessionChanges([session()], [session(), session({ id: "ses_2", updated: 3, number: 2, latestID: "ses_2" })])).toBe(
      true,
    )
    expect(hasSessionChanges([session()], [session({ title: "Renamed" })])).toBe(true)
  })
})
