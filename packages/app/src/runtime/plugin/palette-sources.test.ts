import { expect, test } from "bun:test"
import type { PaletteEntry, PaletteSource } from "@opencode/plugin/gui"
import { ServerConnection } from "@/runtime/server/registry"
import { uniqueCommandPaletteEntries } from "@/shell/commands/palette"
import type { Item } from "./host"
import { pluginPaletteEntries, searchPluginSources } from "./palette-sources"

const row = (session: string, extra: Partial<PaletteEntry> = {}): PaletteEntry => ({
  id: session,
  title: session,
  server: "sidecar",
  session,
  ...extra,
})

const source = (plugin: string, search: PaletteSource["search"]): Item<PaletteSource> => ({
  key: plugin,
  plugin,
  value: { id: "history", search },
})

test("a row takes the built-in session id, so a session both searches find lists once", () => {
  const builtin = { id: "session:sidecar:ses_a", type: "session" as const, title: "built-in", category: "Sessions" }

  const entries = uniqueCommandPaletteEntries([
    builtin,
    ...pluginPaletteEntries([row("ses_a"), row("ses_b")], "Sessions"),
  ])

  expect(entries.map((entry) => `${entry.id} ${entry.title}`)).toEqual([
    "session:sidecar:ses_a built-in",
    "session:sidecar:ses_b ses_b",
  ])
})

test("maps a row onto a session entry under the palette's session section", () => {
  const [entry] = pluginPaletteEntries([row("ses_a", { description: "…hoá đơn…", updated: 7 })], "Sessions")

  expect(entry.type).toBe("session")
  expect(entry.sessionID).toBe("ses_a")
  expect(entry.server).toBe(ServerConnection.Key.make("sidecar"))
  expect(entry.category).toBe("Sessions")
  expect(entry.description).toBe("…hoá đơn…")
  expect(entry.updated).toBe(7)
})

test("a source that rejects or throws drops only its own rows", async () => {
  const errors: unknown[] = []
  const original = console.error
  console.error = (...args: unknown[]) => void errors.push(args)

  const entries = await searchPluginSources(
    [
      source("broken", () => Promise.reject(new Error("offline"))),
      source("throws", () => {
        throw new Error("sync")
      }),
      source("works", async () => [row("ses_ok")]),
    ],
    "query",
    new AbortController().signal,
    "Sessions",
  ).finally(() => {
    console.error = original
  })

  expect(entries.map((entry) => entry.sessionID)).toEqual(["ses_ok"])
  expect(errors).toHaveLength(2)
})

test("an empty query searches no source", async () => {
  const entries = await searchPluginSources(
    [source("acme", () => Promise.reject(new Error("must not run")))],
    "",
    new AbortController().signal,
    "Sessions",
  )

  expect(entries).toEqual([])
})
