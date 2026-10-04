import { expect, test } from "bun:test"
import { extensionEnabled } from "@opencode/gui-extensions/sdk/bridge"
import details from "../../../../gui-extensions/src/details/index"
import context from "../../../../gui-extensions/src/context/index"
import { openDatabase } from "../storage/database"
import { extension } from "../storage/schema"
import { readEnableState } from "./enable-state"
import { createManager } from "./manager"

test.each([
  { name: "no setting", rows: [], expected: true },
  { name: "an old disabled setting", rows: [{ id: "older", enabled: false }], expected: false },
  { name: "an old enabled setting", rows: [{ id: "older", enabled: true }], expected: true },
  {
    name: "the newest old setting",
    rows: [{ id: "older", enabled: false }, { id: "previous", enabled: true }],
    expected: true,
  },
  {
    name: "the current enabled setting",
    rows: [{ id: "previous", enabled: false }, { id: "current", enabled: true }],
    expected: true,
  },
  {
    name: "the current disabled setting",
    rows: [{ id: "previous", enabled: true }, { id: "current", enabled: false }],
    expected: false,
  },
])("both hosts resolve $name from real database rows, and a new setting wins", (input) => {
  const database = openDatabase(":memory:")
  const definition = { id: "current", legacy: ["previous", "older"] }
  const manager = createManager(database.db, () => false, [definition])
  input.rows.forEach((row) => database.db.insert(extension).values(row).run())

  expect(manager.enabled(definition.id)).toBe(input.expected)
  expect(extensionEnabled(definition, readEnableState(database.db.$client))).toBe(input.expected)

  const before = database.db.select().from(extension).all()

  manager.setEnabled(definition.id, !input.expected)
  expect(manager.enabled(definition.id)).toBe(!input.expected)
  expect(extensionEnabled(definition, readEnableState(database.db.$client))).toBe(!input.expected)
  expect(database.db.select().from(extension).all().filter((row) => row.id !== definition.id)).toEqual(
    before.filter((row) => row.id !== definition.id),
  )
  database.close()
})

test.each([details, context])("$id preserves disabled state from its shipping legacy declaration", (definition) => {
  const database = openDatabase(":memory:")
  const manager = createManager(database.db, () => false, [definition])
  database.db.insert(extension).values({ id: definition.legacy[0], enabled: false }).run()

  expect(manager.enabled(definition.id)).toBe(false)
  expect(extensionEnabled(definition, readEnableState(database.db.$client))).toBe(false)
  database.close()
})
