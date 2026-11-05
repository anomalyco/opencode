import { afterEach, describe, expect, test, vi } from "bun:test"
import { createComputed, createRoot } from "solid-js"
import type { FileNode } from "@/runtime/server/types"
import { createFileTreeStore } from "@/workspaces/files/tree-store"

// Runs under the browser build: the server build of Solid neither re-runs computations nor runs cleanups.

const file = (path: string): FileNode => ({ path, type: "file", name: path, absolute: `/repo/${path}`, ignored: false })

type Call = { dir: string; resolve: (nodes: FileNode[]) => void; reject: (error: Error) => void }

function setup(scope = () => "/repo") {
  const calls: Call[] = []
  const errors: string[] = []

  return createRoot((dispose) => ({
    calls,
    errors,
    dispose,
    store: createFileTreeStore({
      scope,
      normalizeDir: (input) => input,
      list: (dir) => new Promise((resolve, reject) => calls.push({ dir, resolve, reject })),
      onError: (message) => errors.push(message),
    }),
  }))
}

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

const paths = (nodes: readonly FileNode[]) => nodes.map((node) => node.path)

afterEach(() => {
  vi.useRealTimers()
})

describe("file tree store", () => {
  test("a forced reload during a listing resolves after a fresh listing", async () => {
    const tree = setup()
    void tree.store.listDir("src")
    const forced = tree.store.listDir("src", { force: true }).then(() => paths(tree.store.children("src")))
    const resolved: string[][] = []
    void forced.then((result) => resolved.push(result))
    expect(tree.calls.map((call) => call.dir)).toEqual(["src"])

    tree.calls[0]!.resolve([file("src/a.ts")])
    await flush()
    expect(resolved).toEqual([])
    expect(paths(tree.store.children("src"))).toEqual(["src/a.ts"])
    expect(tree.calls.map((call) => call.dir)).toEqual(["src", "src"])

    tree.calls[1]!.resolve([file("src/a.ts"), file("src/b.ts")])
    expect(await forced).toEqual(["src/a.ts", "src/b.ts"])
    tree.dispose()
  })

  test("a listing from the previous workspace neither reports nor releases the new workspace's listing", async () => {
    const workspace = { directory: "/a" }
    const tree = setup(() => workspace.directory)
    void tree.store.listDir("")
    workspace.directory = "/b"
    tree.store.reset()
    void tree.store.listDir("")

    tree.calls[0]!.reject(new Error("gone"))
    await flush()
    const joined = tree.store.listDir("")
    expect(tree.calls).toHaveLength(2)
    expect(tree.errors).toEqual([])

    tree.calls[1]!.resolve([file("b.ts")])
    await joined
    expect(paths(tree.store.children(""))).toEqual(["b.ts"])
    tree.dispose()
  })

  test("the root's loaded state wakes readers only when it changes or the workspace resets", async () => {
    const tree = setup()
    const reads: boolean[] = []

    createRoot((dispose) => {
      createComputed(() => reads.push(tree.store.dirState("")?.loaded ?? false))
      void tree.store.listDir("")
      tree.calls[0]!.reject(new Error("boom"))

      return dispose
    })

    await flush()
    expect(tree.store.dirState("")?.error).toBe("boom")
    expect(tree.errors).toEqual(["boom"])
    expect(reads).toEqual([false])

    tree.store.reset()
    expect(reads).toEqual([false, false])
    tree.dispose()
  })

  test("a hung listing times out, and disposal cancels pending work", async () => {
    vi.useFakeTimers()
    const tree = setup()
    const hung = tree.store.listDir("src")
    vi.advanceTimersToNextTimer()
    await hung
    expect(tree.store.dirState("src")).toMatchObject({ loaded: false, loading: false })
    expect(tree.errors).toEqual([""])

    const disposed = tree.store.listDir("lib")
    tree.dispose()
    await disposed
    vi.advanceTimersToNextTimer()
    tree.calls[1]!.reject(new Error("late"))
    await Promise.resolve()
    expect(tree.errors).toEqual([""])
  })
})
