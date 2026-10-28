import { expect, test } from "bun:test"
import { pluginEnabled } from "@opencode/plugin/gui/host"
import { openDatabase } from "../storage/database"
import { plugin } from "../storage/schema"
import { readEnableState } from "./enable-state"
import { PluginError } from "./error"
import { createManager } from "./manager"

test.each([
  { name: "no setting", rows: [], expected: true },
  { name: "a disabled setting", rows: [{ id: "current", enabled: false }], expected: false },
  { name: "an enabled setting", rows: [{ id: "current", enabled: true }], expected: true },
  { name: "another plugin's setting", rows: [{ id: "other", enabled: false }], expected: true },
])("both hosts resolve $name from real database rows, and a new setting wins", (input) => {
  const database = openDatabase(":memory:")
  const manager = createManager(database.db, [])
  input.rows.forEach((row) => database.db.insert(plugin).values(row).run())

  expect(manager.enabled("current")).toBe(input.expected)
  expect(pluginEnabled({ id: "current", builtin: false }, readEnableState(database.db.$client))).toBe(input.expected)

  const before = database.db.select().from(plugin).all()

  manager.setEnabled("current", !input.expected)
  expect(manager.enabled("current")).toBe(!input.expected)
  expect(pluginEnabled({ id: "current", builtin: false }, readEnableState(database.db.$client))).toBe(!input.expected)
  expect(
    database.db
      .select()
      .from(plugin)
      .all()
      .filter((row) => row.id !== "current"),
  ).toEqual(before.filter((row) => row.id !== "current"))
  database.close()
})

test("both hosts run a built-in whatever setting is saved under its id, and main saves none for it", () => {
  const database = openDatabase(":memory:")
  const manager = createManager(database.db, ["current"])
  database.db.insert(plugin).values({ id: "current", enabled: false }).run()

  expect(() => manager.setEnabled("current", true)).toThrow(new PluginError("builtin"))
  expect(
    database.db
      .select()
      .from(plugin)
      .all()
      .map((row) => row.enabled),
  ).toEqual([false])
  expect(manager.enabled("current")).toBe(true)
  expect(pluginEnabled({ id: "current", builtin: true }, readEnableState(database.db.$client))).toBe(true)
  database.close()
})
