import { describe, expect, test } from "bun:test"
import { createFileTreeStore } from "./tree-store"
import type { FileNode } from "@opencode-ai/sdk/v2"

function node(path: string, type: FileNode["type"] = "file"): FileNode {
  return { path, type, name: path.split("/").pop() ?? path, absolute: `/repo/${path}`, ignored: false }
}

function makeStore(listing: Record<string, FileNode[]>) {
  const calls: string[] = []
  const store = createFileTreeStore({
    scope: () => "",
    normalizeDir: (input) => input,
    list: (dir) => {
      calls.push(dir)
      return Promise.resolve(listing[dir] ?? [])
    },
    onError: () => {},
  })
  return { store, calls }
}

describe("file tree store", () => {
  test("lists a directory once and caches it", async () => {
    const listing: Record<string, FileNode[]> = { "": [node("src", "directory")] }
    const { store, calls } = makeStore(listing)

    await store.listDir("")
    await store.listDir("")

    expect(calls).toEqual([""])
    expect(store.children("")).toHaveLength(1)
    expect(store.loadedDirs()).toEqual([""])
  })

  test("refreshAll force-reloads loaded directories and picks up new entries", async () => {
    const listing: Record<string, FileNode[]> = {
      "": [node("src", "directory")],
      src: [node("src/a.ts")],
    }
    const { store, calls } = makeStore(listing)

    await store.listDir("")
    await store.listDir("src")
    expect(store.children("src")).toHaveLength(1)

    listing.src = [node("src/a.ts"), node("src/b.ts")]
    await store.refreshAll()

    expect(store.children("src")).toHaveLength(2)
    expect(calls).toEqual(["", "src", "", "src"])
  })

  test("refreshAll skips directories that were never loaded", async () => {
    const listing: Record<string, FileNode[]> = {
      "": [node("src", "directory")],
      src: [node("src/a.ts")],
    }
    const { store, calls } = makeStore(listing)

    await store.listDir("")
    await store.refreshAll()

    expect(calls).toEqual(["", ""])
    expect(store.children("src")).toEqual([])
  })

  test("refreshAll resolves when nothing is loaded", async () => {
    const { store, calls } = makeStore({})
    await store.refreshAll()
    expect(calls).toEqual([])
  })
})
