import { describe, expect, test } from "bun:test"
import { buildFileTreeV2Model, flattenFileTreeV2, flattenLiveFileTreeV2 } from "./file-tree-v2-model"
import type { FileNode } from "@opencode-ai/sdk/v2"

describe("buildFileTreeV2Model", () => {
  test("builds a sorted tree and flattens expanded directories", () => {
    const model = buildFileTreeV2Model(["src/z.ts", "src/lib/b.ts", "src/lib/a.ts", "README.md", "docs/guide.md"])

    expect(model.total).toBe(8)
    expect(flattenFileTreeV2(model, () => true).map((row) => [row.node.path, row.node.type, row.level])).toEqual([
      ["docs", "directory", 0],
      ["docs/guide.md", "file", 1],
      ["src", "directory", 0],
      ["src/lib", "directory", 1],
      ["src/lib/a.ts", "file", 2],
      ["src/lib/b.ts", "file", 2],
      ["src/z.ts", "file", 1],
      ["README.md", "file", 0],
    ])
  })

  test("skips children of collapsed directories", () => {
    const model = buildFileTreeV2Model(["src/lib/a.ts", "src/z.ts"])

    expect(flattenFileTreeV2(model, (path) => path !== "src/lib").map((row) => row.node.path)).toEqual([
      "src",
      "src/lib",
      "src/z.ts",
    ])
  })

  test("normalizes duplicate and messy paths", () => {
    const model = buildFileTreeV2Model(["src\\lib\\a.ts", "src/lib/a.ts", "/src//lib/b.ts/"])
    const rows = flattenFileTreeV2(model, () => true)

    expect(rows.map((row) => row.node.path)).toEqual(["src", "src/lib", "src/lib/a.ts", "src/lib/b.ts"])
    expect(rows.find((row) => row.node.path === "src/lib/a.ts")?.node.originalPath).toBe("src\\lib\\a.ts")
  })

  test("handles deeply nested paths", () => {
    const file = Array.from({ length: 130 }, (_, index) => `d${index}`).join("/") + "/leaf.ts"
    const model = buildFileTreeV2Model([file])

    expect(flattenFileTreeV2(model, () => true)).toHaveLength(131)
  })
})

describe("flattenLiveFileTreeV2", () => {
  test("flattens live children using original paths for nested lookups", () => {
    const nodes: Record<string, FileNode[]> = {
      "": [
        { name: "src", path: "src", absolute: "/repo/src", type: "directory", ignored: false },
        { name: "README.md", path: "README.md", absolute: "/repo/README.md", type: "file", ignored: false },
      ],
      src: [
        { name: "a.ts", path: "src/a.ts", absolute: "/repo/src/a.ts", type: "file", ignored: false },
        { name: "lib", path: "src/lib", absolute: "/repo/src/lib", type: "directory", ignored: false },
      ],
      "src/lib": [{ name: "b.ts", path: "src/lib/b.ts", absolute: "/repo/src/lib/b.ts", type: "file", ignored: false }],
    }

    expect(
      flattenLiveFileTreeV2(
        (path) => nodes[path] ?? [],
        (path) => path === "src",
      ).map((row) => [row.node.path, row.node.originalPath, row.level]),
    ).toEqual([
      ["src", "src", 0],
      ["src/a.ts", "src/a.ts", 1],
      ["src/lib", "src/lib", 1],
      ["README.md", "README.md", 0],
    ])
  })
})
