import { beforeAll, describe, expect, mock, test } from "bun:test"

let shouldListRoot: typeof import("./file-tree").shouldListRoot
let shouldListExpanded: typeof import("./file-tree").shouldListExpanded
let dirsToExpand: typeof import("./file-tree").dirsToExpand
let compareFileTreeNodes: typeof import("@/utils/file-tree-sorting").compareFileTreeNodes

beforeAll(async () => {
  mock.module("@solidjs/router", () => ({
    useNavigate: () => () => undefined,
    useParams: () => ({}),
    useLocation: () => ({}),
    useSearchParams: () => [{}, () => undefined],
  }))
  mock.module("@/context/file", () => ({
    useFile: () => ({
      tree: {
        state: () => undefined,
        list: () => Promise.resolve(),
        children: () => [],
        expand: () => {},
        collapse: () => {},
      },
    }),
  }))
  mock.module("@opencode-ai/ui/collapsible", () => ({
    Collapsible: {
      Trigger: (props: { children?: unknown }) => props.children,
      Content: (props: { children?: unknown }) => props.children,
    },
  }))
  mock.module("@opencode-ai/ui/file-icon", () => ({ FileIcon: () => null }))
  mock.module("@opencode-ai/ui/icon", () => ({ Icon: () => null }))
  mock.module("@opencode-ai/ui/tooltip", () => ({ Tooltip: (props: { children?: unknown }) => props.children }))
  const mod = await import("./file-tree")
  shouldListRoot = mod.shouldListRoot
  shouldListExpanded = mod.shouldListExpanded
  dirsToExpand = mod.dirsToExpand
  const sortingMod = await import("@/utils/file-tree-sorting")
  compareFileTreeNodes = sortingMod.compareFileTreeNodes
})

describe("file tree fetch discipline", () => {
  test("root lists on mount unless already loaded or loading", () => {
    expect(shouldListRoot({ level: 0 })).toBe(true)
    expect(shouldListRoot({ level: 0, dir: { loaded: true } })).toBe(false)
    expect(shouldListRoot({ level: 0, dir: { loading: true } })).toBe(false)
    expect(shouldListRoot({ level: 1 })).toBe(false)
  })

  test("nested dirs list only when expanded and stale", () => {
    expect(shouldListExpanded({ level: 1 })).toBe(false)
    expect(shouldListExpanded({ level: 1, dir: { expanded: false } })).toBe(false)
    expect(shouldListExpanded({ level: 1, dir: { expanded: true } })).toBe(true)
    expect(shouldListExpanded({ level: 1, dir: { expanded: true, loaded: true } })).toBe(false)
    expect(shouldListExpanded({ level: 1, dir: { expanded: true, loading: true } })).toBe(false)
    expect(shouldListExpanded({ level: 0, dir: { expanded: true } })).toBe(false)
  })

  test("allowed auto-expand picks only collapsed dirs", () => {
    const expanded = new Set<string>()
    const filter = { dirs: new Set(["src", "src/components"]) }

    const first = dirsToExpand({
      level: 0,
      filter,
      expanded: (dir) => expanded.has(dir),
    })

    expect(first).toEqual(["src", "src/components"])

    for (const dir of first) expanded.add(dir)

    const second = dirsToExpand({
      level: 0,
      filter,
      expanded: (dir) => expanded.has(dir),
    })

    expect(second).toEqual([])
    expect(dirsToExpand({ level: 1, filter, expanded: () => false })).toEqual([])
  })
})

describe("file tree numeric sorting", () => {
  test("sorts files with numbers numerically", () => {
    const treeForSort = {
      nodes: [
        { kind: "file", name: "lesson-1" },
        { kind: "file", name: "lesson-10" },
        { kind: "file", name: "lesson-11" },
        { kind: "file", name: "lesson-2" },
        { kind: "file", name: "lesson-3" },
      ],
    }
    const indices = treeForSort.nodes.map((_, idx) => idx)
    const sortedIndices = indices.slice().sort((a, b) => compareFileTreeNodes(treeForSort, a, b))
    const sortedNames = sortedIndices.map((idx) => treeForSort.nodes[idx]!.name)

    expect(sortedNames).toEqual(["lesson-1", "lesson-2", "lesson-3", "lesson-10", "lesson-11"])
  })

  test("sorts directories before files", () => {
    const treeForSort = {
      nodes: [
        { kind: "file", name: "file1.txt" },
        { kind: "directory", name: "dir1" },
        { kind: "file", name: "file2.txt" },
        { kind: "directory", name: "dir2" },
      ],
    }
    const indices = treeForSort.nodes.map((_, idx) => idx)
    const sortedIndices = indices.slice().sort((a, b) => compareFileTreeNodes(treeForSort, a, b))
    const sortedNodes = sortedIndices.map((idx) => treeForSort.nodes[idx]!)

    expect(sortedNodes.map((node) => node.kind)).toEqual(["directory", "directory", "file", "file"])
  })

  test("sorts directories alphabetically within each group", () => {
    const treeForSort = {
      nodes: [
        { kind: "directory", name: "zebra" },
        { kind: "directory", name: "apple" },
        { kind: "file", name: "zebra.txt" },
        { kind: "file", name: "apple.txt" },
      ],
    }
    const indices = treeForSort.nodes.map((_, idx) => idx)
    const sortedIndices = indices.slice().sort((a, b) => compareFileTreeNodes(treeForSort, a, b))
    const sortedNodes = sortedIndices.map((idx) => treeForSort.nodes[idx]!)

    expect(sortedNodes.map((node) => node.name)).toEqual(["apple", "zebra", "apple.txt", "zebra.txt"])
  })

  test("handles mixed alphanumeric names", () => {
    const treeForSort = {
      nodes: [
        { kind: "file", name: "version-2.1" },
        { kind: "file", name: "version-10.0" },
        { kind: "file", name: "version-1.5" },
        { kind: "file", name: "version-2.0" },
      ],
    }
    const indices = treeForSort.nodes.map((_, idx) => idx)
    const sortedIndices = indices.slice().sort((a, b) => compareFileTreeNodes(treeForSort, a, b))
    const sortedNames = sortedIndices.map((idx) => treeForSort.nodes[idx]!.name)

    expect(sortedNames).toEqual(["version-1.5", "version-2.0", "version-2.1", "version-10.0"])
  })

  test("handles leading zeros", () => {
    const treeForSort = {
      nodes: [
        { kind: "file", name: "file-001" },
        { kind: "file", name: "file-010" },
        { kind: "file", name: "file-002" },
        { kind: "file", name: "file-1" },
      ],
    }
    const indices = treeForSort.nodes.map((_, idx) => idx)
    const sortedIndices = indices.slice().sort((a, b) => compareFileTreeNodes(treeForSort, a, b))
    const sortedNames = sortedIndices.map((idx) => treeForSort.nodes[idx]!.name)

    expect(sortedNames).toEqual(["file-1", "file-001", "file-002", "file-010"])
  })
})
