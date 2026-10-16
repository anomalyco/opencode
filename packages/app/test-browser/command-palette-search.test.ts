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

const session: CommandPaletteEntry = {
  id: "session:copy",
  type: "session",
  title: "Copy session",
  category: "Sessions",
}

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

  test("publishes each source independently and drops stale results on a new query", async () => {
    const files = Promise.withResolvers<CommandPaletteEntry[]>()
    const sessions = Promise.withResolvers<CommandPaletteEntry[]>()
    const fileVisible = Promise.withResolvers<void>()
    const sessionVisible = Promise.withResolvers<void>()

    const root = createRoot((dispose) => {
      const [query, setQuery] = createSignal("copy")

      const search = createCommandPaletteSearch({
        query,
        items: () => [copy],
        sources: [() => sessions.promise, () => files.promise],
      })

      createComputed(() => {
        if (search.items().some((entry) => entry.id === file.id)) fileVisible.resolve()

        if (search.items().some((entry) => entry.id === session.id)) sessionVisible.resolve()
      })

      return { search, setQuery, dispose }
    })

    expect(root.search.items()).toEqual([copy])
    files.resolve([file])
    await fileVisible.promise
    expect(root.search.items()).toEqual([copy, file])
    expect(root.search.loading()).toBe(true)
    sessions.resolve([session])
    await sessionVisible.promise
    expect(root.search.items()).toEqual([copy, session, file])
    expect(root.search.loading()).toBe(false)
    root.setQuery("new query")
    expect(root.search.items()).toEqual([copy])
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
    expect(root.search.failed()).toBe(true)
    root.dispose()
  })

  test("obsolete completions and failures cannot replace the current query or its loading state", async () => {
    const old = Promise.withResolvers<CommandPaletteEntry[]>()
    const obsolete = Promise.withResolvers<CommandPaletteEntry[]>()
    const current = Promise.withResolvers<CommandPaletteEntry[]>()
    const settled = Promise.withResolvers<void>()

    const root = createRoot((dispose) => {
      const [query, setQuery] = createSignal("old")

      const search = createCommandPaletteSearch({
        query,
        items: (text) => (text === "copy" ? [copy] : []),
        sources: [
          (text) => (text === "old" ? old.promise : current.promise),
          (text) => (text === "old" ? obsolete.promise : current.promise),
        ],
      })

      createComputed(() => {
        if (!search.loading()) settled.resolve()
      })

      return { search, setQuery, dispose }
    })

    root.setQuery("copy")
    old.reject(new Error("obsolete failure"))
    obsolete.resolve([session])
    // Drain the obsolete promise callbacks while the current requests remain deliberately unresolved.
    await new Promise<void>(setImmediate)
    expect(root.search.items()).toEqual([copy])
    expect(root.search.loading()).toBe(true)
    expect(root.search.failed()).toBe(false)
    current.resolve([copy, file])
    await settled.promise
    expect(root.search.items()).toEqual([copy, file])
    expect(root.search.failed()).toBe(false)
    root.dispose()
  })
})
