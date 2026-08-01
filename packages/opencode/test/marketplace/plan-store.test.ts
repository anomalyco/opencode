import { describe, expect, test } from "bun:test"
import { createMarketplacePlanStore } from "../../src/marketplace/plan-store"

describe("marketplace plan store", () => {
  test("consumes a plan exactly once", () => {
    const store = createMarketplacePlanStore<string>()
    const plan = store.create(3, "prepared")

    expect(store.get(plan.id)).toMatchObject({ ok: true, plan: { revision: 3, value: "prepared" } })
    expect(store.consume(plan.id)).toMatchObject({ ok: true })
    expect(store.consume(plan.id)).toEqual({ ok: false, reason: "consumed" })
  })

  test("rejects an expired plan", () => {
    let time = 100
    const store = createMarketplacePlanStore<string>({ ttl: 10, now: () => time })
    const plan = store.create(0, "prepared")
    time = 110

    expect(store.consume(plan.id)).toEqual({ ok: false, reason: "expired" })
  })
})
