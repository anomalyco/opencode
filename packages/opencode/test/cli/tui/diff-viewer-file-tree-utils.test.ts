import { describe, expect, test } from "bun:test"
import {
  allExpandedFileTreeDirectories,
  buildFileTree,
  fileTreeFileSelection,
  flattenFileTree,
  moveFileTreeSelection,
  moveFileTreeSelectionToFirstChild,
  moveFileTreeSelectionToFile,
  moveFileTreeSelectionToParent,
  movePatchFileIndex,
  orderedPatchFileIndexes,
  setFileTreeDirectoryExpanded,
  showDiffViewerFileTree,
  singlePatchFileIndex,
  toggleFileTreeDirectory,
} from "../../../src/cli/cmd/tui/feature-plugins/system/diff-viewer-file-tree-utils"

describe("diff viewer file tree utilities", () => {
  test("builds a nested tree with deduplicated directories and file indexes", () => {
    const tree = buildFileTree([
      { file: "src/config/tui.ts" },
      { file: "src/config/keybind.ts" },
      { file: "src/session/index.ts" },
    ])

    expect(tree.nodes.filter((node) => node.kind === "directory" && node.name === "src")).toHaveLength(1)
    expect(tree.nodes.filter((node) => node.kind === "directory" && node.name === "config")).toHaveLength(1)
    expect(tree.nodes.filter((node) => node.kind === "directory" && node.name === "session")).toHaveLength(1)
    expect(
      tree.nodes
        .filter((node) => node.kind === "file")
        .map((node) => ({ name: node.name, fileIndex: node.fileIndex, depth: node.depth })),
    ).toEqual([
      { name: "tui.ts", fileIndex: 0, depth: 2 },
      { name: "keybind.ts", fileIndex: 1, depth: 2 },
      { name: "index.ts", fileIndex: 2, depth: 2 },
    ])
  })

  test("sorts directories before files and alphabetically within each group", () => {
    const rows = flattenFileTree(
      buildFileTree([
        { file: "z-file.ts" },
        { file: "b/file.ts" },
        { file: "a/zeta.ts" },
        { file: "b/alpha.ts" },
        { file: "a/alpha.ts" },
      ]),
    )

    expect(rows.map((row) => `${"  ".repeat(row.depth)}${row.kind}:${row.name}`)).toEqual([
      "directory:a",
      "  file:alpha.ts",
      "  file:zeta.ts",
      "directory:b",
      "  file:alpha.ts",
      "  file:file.ts",
      "file:z-file.ts",
    ])
  })

  test("sorts root-level files without creating directories", () => {
    const tree = buildFileTree([{ file: "zeta.ts" }, { file: "alpha.ts" }, { file: "beta.ts" }])

    expect(tree.nodes.every((node) => node.kind === "file")).toBe(true)
    expect(flattenFileTree(tree).map((row) => row.name)).toEqual(["alpha.ts", "beta.ts", "zeta.ts"])
  })

  test("collapses unary directory chains while flattening", () => {
    const rows = flattenFileTree(
      buildFileTree([{ file: "packages/opencode/src/cli/app.ts" }, { file: "packages/opencode/src/server/server.ts" }]),
    )

    expect(rows.map((row) => `${"  ".repeat(row.depth)}${row.kind}:${row.name}`)).toEqual([
      "directory:packages/opencode/src",
      "  directory:cli",
      "    file:app.ts",
      "  directory:server",
      "    file:server.ts",
    ])
  })

  test("does not collapse a directory into a file row", () => {
    const rows = flattenFileTree(buildFileTree([{ file: "packages/opencode/src/app.ts" }]))

    expect(rows.map((row) => `${"  ".repeat(row.depth)}${row.kind}:${row.name}`)).toEqual([
      "directory:packages/opencode/src",
      "  file:app.ts",
    ])
  })

  test("stops collapsing at branches", () => {
    const rows = flattenFileTree(
      buildFileTree([
        { file: "packages/opencode/src/cli/app.ts" },
        { file: "packages/opencode/src/server/server.ts" },
        { file: "packages/readme.md" },
      ]),
    )

    expect(rows.map((row) => `${"  ".repeat(row.depth)}${row.kind}:${row.name}`)).toEqual([
      "directory:packages",
      "  directory:opencode/src",
      "    directory:cli",
      "      file:app.ts",
      "    directory:server",
      "      file:server.ts",
      "  file:readme.md",
    ])
  })

  test("keeps same directory names under different parents separate", () => {
    const rows = flattenFileTree(
      buildFileTree([{ file: "components/button.ts" }, { file: "docs/components/usage.md" }]),
    )

    expect(rows.map((row) => `${"  ".repeat(row.depth)}${row.kind}:${row.name}`)).toEqual([
      "directory:components",
      "  file:button.ts",
      "directory:docs/components",
      "  file:usage.md",
    ])
  })

  test("flattens all-expanded rows depth-first with depths and file references", () => {
    const rows = flattenFileTree(
      buildFileTree([{ file: "src/config/tui.ts" }, { file: "src/config/keybind.ts" }, { file: "README.md" }]),
    )

    expect(rows.map((row) => ({ name: row.name, kind: row.kind, depth: row.depth, fileIndex: row.fileIndex }))).toEqual(
      [
        { name: "src/config", kind: "directory", depth: 0, fileIndex: undefined },
        { name: "keybind.ts", kind: "file", depth: 1, fileIndex: 1 },
        { name: "tui.ts", kind: "file", depth: 1, fileIndex: 0 },
        { name: "README.md", kind: "file", depth: 0, fileIndex: 2 },
      ],
    )
  })

  test("collapses expanded unary children under the first visible directory id", () => {
    const tree = buildFileTree([
      { file: "packages/opencode/src/cli/app.ts" },
      { file: "packages/opencode/src/server/server.ts" },
    ])
    const packages = tree.nodes.find((node) => node.kind === "directory" && node.name === "packages")!

    expect(flattenFileTree(tree, new Set()).map((row) => row.name)).toEqual(["packages/opencode/src"])
    expect(flattenFileTree(tree, new Set([packages.id])).map((row) => row.name)).toEqual([
      "packages/opencode/src",
      "cli",
      "server",
    ])
  })

  test("flattens only expanded directory descendants when expansion is provided", () => {
    const tree = buildFileTree([{ file: "src/config/tui.ts" }, { file: "src/session/index.ts" }, { file: "README.md" }])
    const src = tree.nodes.find((node) => node.kind === "directory" && node.name === "src")!
    const config = tree.nodes.find((node) => node.kind === "directory" && node.name === "config")!

    expect(flattenFileTree(tree, new Set()).map((row) => row.name)).toEqual(["src", "README.md"])
    expect(flattenFileTree(tree, new Set([src.id])).map((row) => row.name)).toEqual([
      "src",
      "config",
      "session",
      "README.md",
    ])
    expect(flattenFileTree(tree, new Set([src.id, config.id])).map((row) => row.name)).toEqual([
      "src",
      "config",
      "tui.ts",
      "session",
      "README.md",
    ])
  })

  test("moves selection across visible rows and clamps to bounds", () => {
    const rows = flattenFileTree(buildFileTree([{ file: "src/config/tui.ts" }, { file: "README.md" }]))

    expect(moveFileTreeSelection(rows, undefined, 1)).toBe(rows[0]!.id)
    expect(moveFileTreeSelection(rows, rows[0]!.id, 1)).toBe(rows[1]!.id)
    expect(moveFileTreeSelection(rows, rows[1]!.id, 99)).toBe(rows[rows.length - 1]!.id)
    expect(moveFileTreeSelection(rows, rows[1]!.id, -99)).toBe(rows[0]!.id)
    expect(moveFileTreeSelection([], undefined, 1)).toBeUndefined()
  })

  test("moves directory selection to first visible child", () => {
    const rows = flattenFileTree(buildFileTree([{ file: "src/config/tui.ts" }, { file: "src/session/index.ts" }]))
    const src = rows.find((row) => row.kind === "directory" && row.name === "src")!
    const config = rows.find((row) => row.kind === "directory" && row.name === "config")!
    const tui = rows.find((row) => row.name === "tui.ts")!

    expect(moveFileTreeSelectionToFirstChild(rows, src.id)).toBe(config.id)
    expect(moveFileTreeSelectionToFirstChild(rows, tui.id)).toBe(tui.id)
    expect(moveFileTreeSelectionToFirstChild(rows, undefined)).toBeUndefined()
  })

  test("moves collapsed chain selection to first visible child", () => {
    const rows = flattenFileTree(
      buildFileTree([{ file: "packages/opencode/src/cli/app.ts" }, { file: "packages/opencode/src/server/server.ts" }]),
    )
    const packages = rows.find((row) => row.kind === "directory" && row.name === "packages/opencode/src")!
    const cli = rows.find((row) => row.kind === "directory" && row.name === "cli")!

    expect(moveFileTreeSelectionToFirstChild(rows, packages.id)).toBe(cli.id)
  })

  test("moves file and collapsed directory selection to visible parent", () => {
    const rows = flattenFileTree(
      buildFileTree([{ file: "packages/opencode/src/cli/app.ts" }, { file: "packages/opencode/src/server/server.ts" }]),
    )
    const root = rows.find((row) => row.kind === "directory" && row.name === "packages/opencode/src")!
    const cli = rows.find((row) => row.kind === "directory" && row.name === "cli")!
    const app = rows.find((row) => row.name === "app.ts")!

    expect(moveFileTreeSelectionToParent(rows, app.id)).toBe(cli.id)
    expect(moveFileTreeSelectionToParent(rows, cli.id)).toBe(root.id)
    expect(moveFileTreeSelectionToParent(rows, root.id)).toBe(root.id)
    expect(moveFileTreeSelectionToParent(rows, undefined)).toBeUndefined()
  })

  test("moves file selection relative to the highlighted row", () => {
    const rows = flattenFileTree(
      buildFileTree([{ file: "src/config/tui.ts" }, { file: "src/session/index.ts" }, { file: "README.md" }]),
    )
    const config = rows.find((row) => row.kind === "directory" && row.name === "config")!
    const session = rows.find((row) => row.kind === "directory" && row.name === "session")!
    const tui = rows.find((row) => row.name === "tui.ts")!
    const index = rows.find((row) => row.name === "index.ts")!
    const readme = rows.find((row) => row.name === "README.md")!

    expect(moveFileTreeSelectionToFile(rows, undefined, 1)).toBe(tui.id)
    expect(moveFileTreeSelectionToFile(rows, undefined, -1)).toBe(readme.id)
    expect(moveFileTreeSelectionToFile(rows, config.id, 1)).toBe(tui.id)
    expect(moveFileTreeSelectionToFile(rows, session.id, -1)).toBe(tui.id)
    expect(moveFileTreeSelectionToFile(rows, tui.id, 1)).toBe(index.id)
    expect(moveFileTreeSelectionToFile(rows, index.id, -1)).toBe(tui.id)
    expect(moveFileTreeSelectionToFile(rows, readme.id, 1)).toBe(readme.id)
  })

  test("selects a file tree node and expands its parents for a patch file", () => {
    const tree = buildFileTree([{ file: "src/config/tui.ts" }, { file: "src/session/index.ts" }, { file: "README.md" }])
    const selection = fileTreeFileSelection(tree, 1)

    expect(selection?.highlightedNode).toBe(
      tree.nodes.find((node) => node.kind === "file" && node.name === "index.ts")?.id,
    )
    expect([...selection!.expandedNodes].map((id) => tree.nodes[id]!.name)).toEqual(["session", "src"])
    expect(fileTreeFileSelection(tree, 99)).toBeUndefined()
  })

  test("prefers the selected file when choosing the single patch file", () => {
    expect(singlePatchFileIndex(2, 1, 0, 3)).toBe(2)
    expect(singlePatchFileIndex(undefined, 1, 0, 3)).toBe(1)
    expect(singlePatchFileIndex(undefined, undefined, 0, 3)).toBe(0)
    expect(singlePatchFileIndex(undefined, undefined, undefined, 3)).toBe(3)
  })

  test("orders patches by the flattened file tree order", () => {
    const rows = flattenFileTree(
      buildFileTree([
        { file: "src/dir-8/juniper-4.ts" },
        { file: "src/dir-8/harbor-94.ts" },
        { file: "src/dir-8/cedar-16.ts" },
      ]),
    )

    expect(orderedPatchFileIndexes(rows)).toEqual([2, 1, 0])
  })

  test("shows the diff viewer file tree only when enabled and files exist", () => {
    expect(showDiffViewerFileTree(true, 1)).toBe(true)
    expect(showDiffViewerFileTree(true, 0)).toBe(false)
    expect(showDiffViewerFileTree(false, 1)).toBe(false)
    expect(showDiffViewerFileTree(false, 0)).toBe(false)
  })

  test("moves patch selection through the ordered patch file indexes", () => {
    const fileIndexes = [2, 1, 0]

    expect(movePatchFileIndex(fileIndexes, undefined, 1)).toBe(2)
    expect(movePatchFileIndex(fileIndexes, undefined, -1)).toBe(2)
    expect(movePatchFileIndex(fileIndexes, 2, 1)).toBe(1)
    expect(movePatchFileIndex(fileIndexes, 1, -1)).toBe(2)
    expect(movePatchFileIndex(fileIndexes, 0, 1)).toBe(0)
    expect(movePatchFileIndex(fileIndexes, 99, 1)).toBe(2)
    expect(movePatchFileIndex(fileIndexes, 99, -1)).toBe(2)
    expect(movePatchFileIndex([], undefined, 1)).toBeUndefined()
  })

  test("toggles only selected directory expansion", () => {
    const tree = buildFileTree([{ file: "src/config/tui.ts" }, { file: "README.md" }])
    const src = tree.nodes.find((node) => node.kind === "directory" && node.name === "src")!
    const readme = tree.nodes.find((node) => node.kind === "file" && node.name === "README.md")!
    const expanded = allExpandedFileTreeDirectories(tree)

    const collapsed = toggleFileTreeDirectory(tree, expanded, src.id)
    expect(collapsed.has(src.id)).toBe(false)
    expect(flattenFileTree(tree, collapsed).map((row) => row.name)).toEqual(["src/config", "README.md"])

    const reopened = toggleFileTreeDirectory(tree, collapsed, src.id)
    expect(reopened.has(src.id)).toBe(true)

    expect(toggleFileTreeDirectory(tree, reopened, readme.id)).toBe(reopened)
    expect(toggleFileTreeDirectory(tree, reopened, undefined)).toBe(reopened)
  })

  test("sets only selected directory expansion", () => {
    const tree = buildFileTree([{ file: "src/config/tui.ts" }, { file: "README.md" }])
    const src = tree.nodes.find((node) => node.kind === "directory" && node.name === "src")!
    const readme = tree.nodes.find((node) => node.kind === "file" && node.name === "README.md")!
    const expanded = allExpandedFileTreeDirectories(tree)

    const collapsed = setFileTreeDirectoryExpanded(tree, expanded, src.id, false)
    expect(collapsed.has(src.id)).toBe(false)

    const reopened = setFileTreeDirectoryExpanded(tree, collapsed, src.id, true)
    expect(reopened.has(src.id)).toBe(true)

    expect(setFileTreeDirectoryExpanded(tree, reopened, readme.id, false)).toBe(reopened)
    expect(setFileTreeDirectoryExpanded(tree, reopened, undefined, false)).toBe(reopened)
  })
})
