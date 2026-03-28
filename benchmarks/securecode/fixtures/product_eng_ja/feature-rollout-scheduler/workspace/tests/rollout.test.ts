import { strict as assert } from "node:assert"
import test from "node:test"
import { listRollouts, registerRollout } from "../src/api/rollout"

test("registers a new rollout", () => {
  const row = registerRollout({ featureKey: "new-home", tenantId: "tenant-a", startsAt: "2026-03-21T10:00:00Z" })
  assert.equal(row.ok, true)
})

test("duplicate feature and tenant is rejected", () => {
  registerRollout({ featureKey: "new-home", tenantId: "tenant-b", startsAt: "2026-03-21T09:00:00Z" })
  const row = registerRollout({ featureKey: "new-home", tenantId: "tenant-b", startsAt: "2026-03-21T11:00:00Z" })
  assert.equal(row.ok, false)
  assert.equal(row.reason, "duplicate-rollout")
})

test("listRollouts sorts by startsAt ascending", () => {
  const rows = listRollouts()
  assert.equal(rows[0].startsAt <= rows[rows.length - 1].startsAt, true)
})
