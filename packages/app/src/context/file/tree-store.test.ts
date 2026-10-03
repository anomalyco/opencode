import { describe, expect, test } from "bun:test"
import type { FileNode } from "@opencode-ai/sdk/v2"
import { createFileTreeStore } from "./tree-store"

function setup() {
  const scope = { directory: "/first" }
  const requests: ReturnType<typeof Promise.withResolvers<FileNode[]>>[] = []
  const errors: string[] = []
  const tree = createFileTreeStore({
    scope: () => scope.directory,
    normalizeDir: (path) => path,
    list: () => {
      const request = Promise.withResolvers<FileNode[]>()
      requests.push(request)
      return request.promise
    },
    onError: (message) => errors.push(message),
  })
  return { tree, scope, requests, errors }
}

function file(path: string): FileNode {
  return { path, name: path, absolute: `/first/${path}`, type: "file", ignored: false }
}

describe("file tree request ownership", () => {
  test("old project completion preserves the new project's pending request", async () => {
    const state = setup()
    const old = state.tree.listDir("")
    state.scope.directory = "/second"
    state.tree.reset()
    const current = state.tree.listDir("")
    state.requests[0].resolve([])
    await old

    expect(state.tree.listDir("")).toBe(current)
    expect(state.requests).toHaveLength(2)
    state.requests[1].resolve([])
    await current
  })

  test("a response from before reset cannot overwrite the same project's new tree", async () => {
    const state = setup()
    const old = state.tree.listDir("")
    state.tree.reset()
    const current = state.tree.listDir("")
    state.requests[1].resolve([file("new.txt")])
    await current
    state.requests[0].resolve([file("old.txt")])
    await old

    expect(state.tree.children("").map((node) => node.path)).toEqual(["new.txt"])
    expect(state.tree.node("old.txt")).toBeUndefined()
  })

  test("an error from before reset cannot clear loading or report a stale failure", async () => {
    const state = setup()
    const old = state.tree.listDir("")
    state.tree.reset()
    const current = state.tree.listDir("")
    state.requests[0].reject(new Error("old failure"))
    await old

    expect(state.tree.dirState("")?.loading).toBe(true)
    expect(state.tree.dirState("")?.error).toBeUndefined()
    expect(state.errors).toEqual([])
    expect(state.tree.listDir("")).toBe(current)
    state.requests[1].resolve([])
    await current
  })

  test("current failures are reported and can be retried", async () => {
    const state = setup()
    const failed = state.tree.listDir("")
    state.requests[0].reject(new Error("current failure"))
    await failed
    expect(state.errors).toEqual(["current failure"])
    expect(state.tree.dirState("")?.loading).toBe(false)

    const retry = state.tree.listDir("")
    state.requests[1].resolve([file("new.txt")])
    await retry
    expect(state.tree.isLoaded("")).toBe(true)
    expect(state.tree.dirState("")?.error).toBeUndefined()
    expect(state.tree.children("").map((node) => node.path)).toEqual(["new.txt"])
  })
})
