import { expect, test } from "bun:test"
import { settledServerCommands } from "../src/component/prompt/autocomplete"

test("server commands are hidden until the current catalog settles", () => {
  const stale = [{ name: "old-workspace-command" }]

  expect(settledServerCommands("loading", stale)).toEqual([])
  expect(settledServerCommands("error", stale)).toEqual([])
  expect(settledServerCommands("complete", stale)).toBe(stale)
})
