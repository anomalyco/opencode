import { describe, expect, test } from "bun:test"
import { buildFileTreeV2Model, flattenFileTreeV2 } from "./file-tree-v2-model"

describe("file tree v2 model", () => {
  test("builds sorted depth-first rows", () => {
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

  test("omits descendants of collapsed directories", () => {
    const model = buildFileTreeV2Model(["src/lib/a.ts", "src/z.ts"])

    expect(flattenFileTreeV2(model, (path) => path !== "src/lib").map((row) => row.node.path)).toEqual([
      "src",
      "src/lib",
      "src/z.ts",
    ])
  })

  test("normalizes separators and duplicate paths", () => {
    const model = buildFileTreeV2Model(["src\\lib\\a.ts", "src/lib/a.ts", "/src//lib/b.ts/"])
    const rows = flattenFileTreeV2(model, () => true)

    expect(model.total).toBe(4)
    expect(rows.map((row) => row.node.path)).toEqual(["src", "src/lib", "src/lib/a.ts", "src/lib/b.ts"])
    expect(rows.find((row) => row.node.path === "src/lib/a.ts")?.node.originalPath).toBe("src\\lib\\a.ts")
  })

  test("supports paths deeper than the legacy recursion limit", () => {
    const file = `${Array.from({ length: 130 }, (_, index) => `dir-${index}`).join("/")}/file.ts`
    const model = buildFileTreeV2Model([file])

    expect(flattenFileTreeV2(model, () => true)).toHaveLength(131)
  })
})
