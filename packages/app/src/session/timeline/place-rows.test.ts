import { expect, test } from "bun:test"
import { placeRows } from "./place-rows"

// Lists rows by name in one layer. A name keeps its element for as long as it is listed. Reports the order in the
// document, the DOM operations it took, and which rows that stay were taken out of the document on the way.
function place(from: readonly string[], to: readonly string[]) {
  const layer = document.createElement("div")
  const rows = new Map(
    [...from, ...to].map((name) => [name, Object.assign(document.createElement("div"), { textContent: name })]),
  )
  placeRows(
    layer,
    from.map((name) => rows.get(name)!),
  )
  const observer = new MutationObserver(() => {})
  observer.observe(layer, { childList: true })
  placeRows(
    layer,
    to.map((name) => rows.get(name)!),
  )
  const records = observer.takeRecords()
  observer.disconnect()

  return {
    order: Array.from(layer.children, (row) => row.textContent),
    operations: records.length,
    takenOut: records
      .flatMap((record) => Array.from(record.removedNodes, (row) => row.textContent ?? ""))
      .filter((name) => to.includes(name)),
  }
}

test.each([
  {
    name: "a page of history lands above a row and a turn gap appears below it",
    from: ["notice", "prompt", "reply"],
    to: ["older prompt", "older reply", "notice", "gap", "prompt", "reply"],
    operations: 3,
  },
  {
    name: "a turn ends around the reply being read",
    from: ["prompt", "thinking", "reply", "status"],
    to: ["prompt", "thoughts", "reply", "worked", "divider"],
    operations: 5,
  },
  {
    name: "one new row on each side of the only row",
    from: ["reply"],
    to: ["before", "reply", "after"],
    operations: 2,
  },
  {
    name: "rows scroll out of the mounted range at both ends",
    from: ["first", "second", "third", "fourth"],
    to: ["second", "third"],
    operations: 2,
  },
])("a row that stays is never taken out of the document: $name", (shape) => {
  expect(place(shape.from, shape.to)).toEqual({ order: [...shape.to], operations: shape.operations, takenOut: [] })
})

test("rows that change places end in the order listed", () => {
  expect(place(["first", "second", "third"], ["third", "new", "first", "second"]).order).toEqual([
    "third",
    "new",
    "first",
    "second",
  ])
})
