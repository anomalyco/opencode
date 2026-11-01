import { expect, test } from "bun:test"
import type { PaletteEntry } from "@opencode/plugin/gui"
import { ServerConnection } from "@/runtime/server/registry"
import { pluginPaletteEntries } from "./palette-sources"

const row = (id: string, extra: Partial<PaletteEntry> = {}): PaletteEntry => ({
  id,
  title: id,
  server: "sidecar",
  session: `ses_${id}`,
  ...extra,
})

test("namespaces row ids by plugin and source, so two plugins never collide", () => {
  const entries = pluginPaletteEntries("acme", "history", [row("a")], "Sessions")

  expect(entries[0].id).toBe("plugin:acme:history:a")
})

test("fills the category, opens the row's session, and keeps optional fields", () => {
  const [entry] = pluginPaletteEntries("acme", "history", [row("a", { description: "…hoá đơn…", updated: 7 })], "Sessions")

  expect(entry.type).toBe("session")
  expect(entry.sessionID).toBe("ses_a")
  expect(entry.server).toBe(ServerConnection.Key.make("sidecar"))
  expect(entry.category).toBe("Sessions")
  expect(entry.description).toBe("…hoá đơn…")
  expect(entry.updated).toBe(7)
})

test("a row's own category wins over the default", () => {
  const [entry] = pluginPaletteEntries("acme", "history", [row("a", { category: "Projects" })], "Sessions")

  expect(entry.category).toBe("Projects")
})
