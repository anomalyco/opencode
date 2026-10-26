import { expect, test } from "bun:test"
import { reconnectOrder } from "./connection"

test("held directories refresh before the rest, otherwise keeping their order", () => {
  const held = new Set(["/b", "/d"])
  expect(reconnectOrder(["/a", "/b", "/c", "/d"], (directory) => held.has(directory))).toEqual(["/b", "/d", "/a", "/c"])
  expect(reconnectOrder(["/a", "/c"], (directory) => held.has(directory))).toEqual(["/a", "/c"])
})
