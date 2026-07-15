import { expect, test } from "bun:test"
import { DevTools } from "../src/devtools"

test("registers and updates grouped DevTools data", () => {
  const group = DevTools.register({ id: "test", title: "Test data" })

  group.set("Duration", "1.00 ms")
  group.set("Duration", "2.00 ms")
  group.set("Count", 2)

  expect(DevTools.data().find((item) => item.id === "test")).toEqual({
    id: "test",
    title: "Test data",
    entries: [
      { key: "Duration", value: "2.00 ms" },
      { key: "Count", value: 2 },
    ],
  })
})
