import { describe, expect, test } from "bun:test"
import type { FileNode } from "@opencode/plugin/gui"
import {
  buildAllowedTreeInput,
  buildKindsStatus,
  buildLiveTreeInput,
  collectAllowedCollapsedDirs,
  diffStatusLayers,
} from "./tree-model"

describe("buildAllowedTreeInput", () => {
  test("collects normalized paths, ancestor directories, and total count", () => {
    const input = buildAllowedTreeInput(["src/z.ts", "src/lib/b.ts", "src/lib/a.ts", "README.md", "docs/guide.md"])

    expect(input.total).toBe(8)
    expect(input.paths).toEqual(["src/z.ts", "src/lib/b.ts", "src/lib/a.ts", "README.md", "docs/guide.md"])
    expect([...input.directories]).toEqual(["src", "src/lib", "docs"])
    expect([...input.untrackedDirs]).toEqual([])
  })

  test("normalizes duplicate and messy paths while keeping first-seen originalPath", () => {
    const input = buildAllowedTreeInput(["src\\lib\\a.ts", "src/lib/a.ts", "/src//lib/b.ts"])

    expect(input.paths).toEqual(["src/lib/a.ts", "src/lib/b.ts"])
    expect(input.originalByPath.get("src/lib/a.ts")).toBe("src\\lib\\a.ts")
  })

  test("keeps a folder listed as one entry as a trailing-slash directory", () => {
    const input = buildAllowedTreeInput(["research/", "keep.txt"])

    expect(input.paths).toEqual(["research/", "keep.txt"])
    expect([...input.untrackedDirs]).toEqual(["research"])
    expect(input.total).toBe(2)
  })
})

describe("buildLiveTreeInput", () => {
  test("collects live paths and expanded directories using original paths for nested lookups", () => {
    const nodes = new Map<string, FileNode[]>([
      [
        "",
        [
          { name: "src", path: "src\\", absolute: "/repo/src", type: "directory", ignored: false },
          { name: "README.md", path: "README.md", absolute: "/repo/README.md", type: "file", ignored: true },
        ],
      ],
      [
        "src\\",
        [
          { name: "a.ts", path: "src\\a.ts", absolute: "/repo/src/a.ts", type: "file", ignored: false },
          { name: "lib", path: "src\\lib", absolute: "/repo/src/lib", type: "directory", ignored: false },
        ],
      ],
      [
        "src\\lib",
        [{ name: "b.ts", path: "src/lib/b.ts", absolute: "/repo/src/lib/b.ts", type: "file", ignored: false }],
      ],
    ])

    const input = buildLiveTreeInput(
      (path) => nodes.get(path) ?? [],
      (path) => path === "src",
    )

    expect(input.paths).toEqual(["src/", "README.md", "src/a.ts", "src/lib/"])
    expect(input.expandedDirs).toEqual(["src/"])
    expect(input.nodesByPath.get("src")?.path).toBe("src\\")
    expect(input.nodesByPath.get("src/a.ts")?.path).toBe("src\\a.ts")
    expect([...input.ignoredPaths]).toEqual(["README.md"])
  })
})

describe("collectAllowedCollapsedDirs", () => {
  test("keeps tracked folders open and untracked folders closed until the user toggles them", () => {
    const model = buildAllowedTreeInput(["src/lib/a.ts", "docs/guide.md", "research/"])
    const state = new Map([
      ["docs", false],
      ["research", true],
    ])

    expect([...collectAllowedCollapsedDirs(model, (dir) => state.get(dir))]).toEqual(["docs"])
    expect([...collectAllowedCollapsedDirs(model, () => undefined)]).toEqual(["research"])
  })
})

describe("diffStatusLayers", () => {
  test("computes incremental set and remove operations when the change kinds change", () => {
    const previous = {
      kinds: buildKindsStatus(
        new Map([
          ["src/a.ts", "add"],
          ["src/b.ts", "mix"],
        ]),
      ),
      ignored: new Set(["dist/"]),
    }

    const next = {
      kinds: buildKindsStatus(
        new Map([
          ["src/a.ts", "del"],
          ["src/c.ts", "add"],
        ]),
      ),
      ignored: new Set<string>(),
    }

    expect(diffStatusLayers(previous, next)).toEqual({
      remove: ["dist/", "src/b.ts"],
      set: [
        { path: "src/a.ts", status: "deleted" },
        { path: "src/c.ts", status: "added" },
      ],
    })
  })

  test("diffs only ignored entries while the change kinds stay the same map, and a change kind wins", () => {
    const kinds = buildKindsStatus(new Map([["build/", "add"]]))

    expect(
      diffStatusLayers(
        { kinds, ignored: new Set(["dist/", "build/"]) },
        { kinds, ignored: new Set(["build/", "out/"]) },
      ),
    ).toEqual({ remove: ["dist/"], set: [{ path: "out/", status: "ignored" }] })
    expect(diffStatusLayers({ kinds, ignored: new Set() }, { kinds, ignored: new Set(["build/"]) })).toEqual({
      remove: [],
      set: [],
    })
  })
})
