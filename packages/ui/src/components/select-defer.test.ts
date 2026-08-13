import { expect, test } from "bun:test"
import { deferSelect } from "./select-defer"

test("defers controlled select updates until the current selection closes", async () => {
  const order: string[] = []
  deferSelect(() => order.push("update"), "theme")
  order.push("close")

  expect(order).toEqual(["close"])
  await Promise.resolve()
  expect(order).toEqual(["close", "update"])
})
