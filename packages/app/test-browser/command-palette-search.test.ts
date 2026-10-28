import { describe, expect, test } from "bun:test"
import { createComputed, createRoot, createSignal } from "solid-js"
import type { CommandPaletteEntry } from "@/shell/commands/palette"
import { createCommandPaletteSearch } from "@/shell/commands/search"

const copy: CommandPaletteEntry = {
  id: "command:session.copyID",
  type: "command",
  title: "Copy Session ID",
  category: "Commands",
}

const file: CommandPaletteEntry = { id: "file:copy.txt", type: "file", title: "copy.txt", category: "Files" }

const setting: CommandPaletteEntry = {
  id: "setting:copy",
  type: "setting",
  title: "Copy on select",
  category: "Settings",
}

const session: CommandPaletteEntry = {
  id: "session:copy",
  type: "session",
  title: "Copy session",
  category: "Sessions",
  updated: 2,
}

const tab: CommandPaletteEntry = { ...session, id: "session:tab", title: "Copy tab", updated: 1 }

describe("command palette search", () => {
  test("matches commands synchronously and cancels obsolete requests", () => {
    const signals: AbortSignal[] = []

    const root = createRoot((dispose) => {
      const [query, setQuery] = createSignal("")

      const search = createCommandPaletteSearch({
        query,
        items: (text) => (text === "copy session" ? [copy] : []),
        sources: [
          (_text, signal) => {
            signals.push(signal)

            return new Promise<CommandPaletteEntry[]>(() => {})
          },
        ],
      })

      return { search, setQuery, dispose }
    })

    root.setQuery(" copy session ")
    expect(root.search.items()).toEqual([copy])
    expect(root.search.loading()).toBe(true)
    expect(signals[0].aborted).toBe(true)
    root.setQuery("no match")
    expect(root.search.items()).toEqual([])
    expect(signals[1].aborted).toBe(true)
    root.dispose()
    expect(signals[2].aborted).toBe(true)
  })

  test("lists sessions first, open tabs leading, then commands, settings and files, publishes each source independently, and drops stale results on a new query", async () => {
    const files = Promise.withResolvers<CommandPaletteEntry[]>()
    const sessions = Promise.withResolvers<CommandPaletteEntry[]>()
    const fileVisible = Promise.withResolvers<void>()
    const sessionVisible = Promise.withResolvers<void>()

    const root = createRoot((dispose) => {
      const [query, setQuery] = createSignal("copy")

      const search = createCommandPaletteSearch({
        query,
        items: () => [copy, setting],
        sources: [() => sessions.promise, () => files.promise],
        open: (entry) => entry.id === tab.id,
      })

      createComputed(() => {
        if (search.items().some((entry) => entry.id === file.id)) fileVisible.resolve()

        if (search.items().some((entry) => entry.id === session.id)) sessionVisible.resolve()
      })

      return { search, setQuery, dispose }
    })

    expect(root.search.items()).toEqual([copy, setting])
    files.resolve([file])
    await fileVisible.promise
    expect(root.search.items()).toEqual([copy, setting, file])
    expect(root.search.loading()).toBe(true)
    sessions.resolve([session, tab])
    await sessionVisible.promise
    expect(root.search.items()).toEqual([tab, session, copy, setting, file])
    expect(root.search.loading()).toBe(false)
    root.setQuery("new query")
    expect(root.search.items()).toEqual([copy, setting])
    root.dispose()
  })

  test("failed searches do not hide commands or successful sources", async () => {
    const settled = Promise.withResolvers<void>()

    const root = createRoot((dispose) => {
      const search = createCommandPaletteSearch({
        query: () => "copy",
        items: () => [copy],
        sources: [() => Promise.reject(new Error("offline")), () => Promise.resolve([file])],
      })

      createComputed(() => {
        if (!search.loading()) settled.resolve()
      })

      return { search, dispose }
    })

    await settled.promise
    expect(root.search.items()).toEqual([copy, file])
    root.dispose()
  })

  test("filters previous remote results synchronously while a refined query is pending", async () => {
    const first = Promise.withResolvers<CommandPaletteEntry[]>()
    const second = Promise.withResolvers<CommandPaletteEntry[]>()
    const otherFile: CommandPaletteEntry = { id: "file: readme.md", type: "file", title: "readme.md", category: "Files" }
    const ready = Promise.withResolvers<void>()

    const root = createRoot((dispose) => {
      const [query, setQuery] = createSignal("c")

      const search = createCommandPaletteSearch({
        query,
        items: (q) => (q === "c" ? [copy] : []),
        sources: [(q) => (q === "c" ? first.promise : second.promise)],
      })

      createComputed(() => {
        if (search.items().some((entry) => entry.id === file.id)) ready.resolve()
      })

      return { search, setQuery, dispose }
    })

    first.resolve([file, otherFile])
    await ready.promise
    expect(root.search.items()).toEqual([copy, file, otherFile])

    root.setQuery("copy")
    expect(root.search.loading()).toBe(true)
    expect(root.search.items()).toEqual([file])
    root.dispose()
  })
})
