import { expect, test } from "bun:test"
import { compareModelOrder } from "../src/model-order.js"

test("model order is free first, newest release, then name", () => {
  const models = [
    { name: "Paid newest", released: 30, free: false },
    { name: "Free older", released: 10, free: true },
    { name: "Paid unknown", released: 0, free: false },
    { name: "Free Z", released: 20, free: true },
    { name: "Free A", released: 20, free: true },
    { name: "Paid older", released: 10, free: false },
  ]
  expect(models.toSorted(compareModelOrder).map((model) => model.name)).toEqual([
    "Free A",
    "Free Z",
    "Free older",
    "Paid newest",
    "Paid older",
    "Paid unknown",
  ])
  expect(models[0].name).toBe("Paid newest")
})

test("equal model keys retain the caller's existing order", () => {
  const models = ["provider-b", "provider-a"].map((provider) => ({
    provider,
    name: "Claude Haiku 4.5",
    released: 20,
    free: false,
  }))
  expect(compareModelOrder(models[0], models[1])).toBe(0)
  expect(models.toSorted(compareModelOrder)).toEqual(models)
})
