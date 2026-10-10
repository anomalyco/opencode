import { expect, test } from "bun:test"
import type { FileNode } from "@/runtime/server/types"
import { createPathHelpers } from "./path"
import { createFileTreeStore } from "./tree-store"

test.each([
  { scope: "/repo", separator: "/" },
  { scope: "C:\\repo", separator: "\\" },
])("re-lists a recreated directory in $scope", async ({ scope, separator }) => {
  const node = (path: string, type: FileNode["type"]) => ({
    name: path,
    path,
    absolute: `${scope}/${path}`,
    type,
    ignored: false,
  })

  const directory = node(`dir${separator}`, "directory")
  const nested = node(`dir${separator}nested${separator}`, "directory")
  const old = node(`dir${separator}old.txt`, "file")
  const descendant = node(`dir${separator}nested${separator}old.txt`, "file")
  const sibling = node(`dir-other${separator}`, "directory")
  const siblingFile = node(`dir-other${separator}keep.txt`, "file")
  const fresh = node(`dir${separator}new.txt`, "file")

  const snapshots = new Map<string, FileNode[]>([
    ["", [directory, sibling]],
    ["dir", [old, nested]],
    ["dir/nested", [descendant]],
    ["dir-other", [siblingFile]],
  ])

  const requests: string[] = []

  const tree = createFileTreeStore({
    scope: () => scope,
    normalizeDir: createPathHelpers(() => scope).normalizeDir,
    list: async (path) => {
      requests.push(path)

      return snapshots.get(path) ?? []
    },
    onError: (message) => {
      throw new Error(message)
    },
  })

  await tree.listDir("")

  for (const entry of [directory, nested, sibling]) {
    tree.expandDir(entry.path)
    await tree.listDir(entry.path)
  }

  snapshots.set("", [sibling])
  await tree.listDir("", { force: true })

  for (const entry of [directory, nested, old, descendant]) expect(tree.node(entry.path)).toBeUndefined()
  expect(tree.dirState(directory.path)).toBeUndefined()
  expect(tree.dirState(nested.path)).toBeUndefined()
  expect(tree.node(sibling.path)).toEqual(sibling)
  expect(tree.dirState(sibling.path)).toMatchObject({ loaded: true, expanded: true })
  expect(tree.children(sibling.path)).toEqual([siblingFile])

  snapshots.set("", [directory, sibling])
  snapshots.set("dir", [fresh])
  await tree.listDir("", { force: true })
  expect(tree.children(directory.path)).toEqual([])
  tree.expandDir(directory.path)
  expect(requests.filter((path) => path === "dir")).toHaveLength(2)
  await tree.listDir(directory.path)
  expect(tree.children(directory.path)).toEqual([fresh])
})
