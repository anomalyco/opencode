import { expect, test } from "bun:test"
import type { BuiltinCommand } from "@opencode/plugin/gui/builtin"
import { pluginCommandItems } from "./commands"
import type { Item } from "./host"

const command = (plugin: string, id: string, key: string): Item<BuiltinCommand> => ({
  key,
  plugin,
  value: { id, title: key, run() {} },
})

test("publishes each plugin command id once, from its newest owner", () => {
  const items = pluginCommandItems([
    command("details", "toggle", "first timeline"),
    command("acme", "toggle", "acme"),
    command("details", "toggle", "second timeline"),
  ])

  expect(items.map((item) => `${item.plugin}.${item.value.id} ${item.key}`)).toEqual([
    "details.toggle second timeline",
    "acme.toggle acme",
  ])
})
