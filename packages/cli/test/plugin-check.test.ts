import { EOL } from "node:os"
import { expect, test } from "bun:test"
import { displayVersion, format, type Item } from "../src/commands/handlers/plugin/inventory"

test("formats server and TUI package update status", () => {
  const items: Item[] = [
    { runtime: "Server", target: "server", name: "server.plugin", version: "1.2.3", outdated: true },
    { runtime: "TUI", target: "tui", name: "tui", version: "2.0.0", outdated: false },
  ]

  expect(format(items)).toBe(
    ["Server", "  server.plugin 1.2.3 (update available)", "TUI", "  tui 2.0.0 (current)"].join(EOL),
  )
})

test("shortens Git revisions", () => {
  expect(displayVersion("dadba138b7088d61f937869bbc1ef34b1f91188d")).toBe("dadba13")
})
