import { strict as assert } from "node:assert"
import test from "node:test"
import { applyOrderEvent } from "../src/router/orderWebhook"

test("invalid payload is rejected with a reason", () => {
  const row = applyOrderEvent({ type: "created" })
  assert.equal(row.accepted, false)
  assert.equal(row.reason, "invalid-payload")
})

test("duplicate eventId is ignored safely", () => {
  applyOrderEvent({ eventId: "evt-1", type: "created", orderId: "o-1", amount: 1200 })
  const row = applyOrderEvent({ eventId: "evt-1", type: "created", orderId: "o-1", amount: 1200 })
  assert.equal(row.accepted, true)
  assert.equal(row.reason, "duplicate-event")
})

test("paid before created is ignored without crashing", () => {
  const row = applyOrderEvent({ eventId: "evt-2", type: "paid", orderId: "o-2", amount: 2000 })
  assert.equal(row.accepted, false)
  assert.equal(row.reason, "order-not-found")
})
