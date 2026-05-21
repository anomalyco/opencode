/** @jsxImportSource @opentui/solid */
import { describe, expect, test } from "bun:test"
import { RGBA } from "@opentui/core"
import { testRender } from "@opentui/solid"
import type { JSX } from "solid-js"
import { DiffViewerFileTree } from "../../../src/cli/cmd/tui/feature-plugins/system/diff-viewer-file-tree"
import {
  allExpandedFileTreeDirectories,
  buildFileTree,
} from "../../../src/cli/cmd/tui/feature-plugins/system/diff-viewer-file-tree-utils"

const theme = {
  background: RGBA.fromHex("#000000"),
  backgroundPanel: RGBA.fromHex("#111111"),
  backgroundElement: RGBA.fromHex("#333333"),
  primary: RGBA.fromHex("#00ffff"),
  selectedListItemText: RGBA.fromHex("#ffffff"),
  text: RGBA.fromHex("#ffffff"),
  textMuted: RGBA.fromHex("#888888"),
  error: RGBA.fromHex("#ff0000"),
}

describe("DiffViewerFileTree", () => {
  test("renders sorted hierarchical file rows", async () => {
    const app = await testRender(
      () => (
        <DiffViewerFileTree
          files={[
            { file: "z-file.ts" },
            { file: "b/file.ts" },
            { file: "a/zeta.ts" },
            { file: "b/alpha.ts" },
            { file: "a/alpha.ts" },
          ]}
          loading={false}
          error={undefined}
          theme={theme}
          focused={true}
        />
      ),
      { width: 40, height: 20 },
    )

    try {
      await app.renderOnce()
      const lines = visibleLines(app.captureCharFrame())

      expect(lines).toEqual(["▾ a", "    alpha.ts", "    zeta.ts", "▾ b", "    alpha.ts", "    file.ts", "  z-file.ts"])
    } finally {
      app.renderer.destroy()
    }
  })

  test("keeps loading and error quiet while rendering an empty settled state", async () => {
    const loading = await renderFrame(() => (
      <DiffViewerFileTree files={[]} loading={true} error={undefined} theme={theme} />
    ))
    const failed = await renderFrame(() => (
      <DiffViewerFileTree files={[]} loading={false} error={new Error("nope")} theme={theme} />
    ))
    const empty = await renderFrame(() => (
      <DiffViewerFileTree files={[]} loading={false} error={undefined} theme={theme} />
    ))

    expect(loading).not.toContain("Loading diff...")
    expect(loading).not.toContain("No files")
    expect(failed).not.toContain("Failed to load diff")
    expect(failed).not.toContain("No files")
    expect(empty).toContain("No files")
  })

  test("does not render text markers for highlighted rows", async () => {
    const files = [{ file: "src/config/tui.ts" }, { file: "README.md" }]
    const src = buildFileTree(files).nodes.find((node) => node.kind === "directory" && node.name === "src")!

    const focused = visibleLines(
      await renderFrame(() => (
        <DiffViewerFileTree
          files={files}
          loading={false}
          error={undefined}
          theme={theme}
          focused
          highlightedNode={src.id}
        />
      )),
    )
    const unfocused = visibleLines(
      await renderFrame(() => <DiffViewerFileTree files={files} loading={false} error={undefined} theme={theme} />),
    )

    expect(focused).toContain("▾ src/config")
    expect(unfocused).toContain("▾ src/config")
    expect(focused.some((line) => line.includes("*"))).toBe(false)
    expect(unfocused.some((line) => line.includes("*"))).toBe(false)
  })

  test("renders collapsed and expanded directory rows", async () => {
    const files = [{ file: "src/config/tui.ts" }, { file: "README.md" }]
    const tree = buildFileTree(files)
    const src = tree.nodes.find((node) => node.kind === "directory" && node.name === "src")!
    const collapsed = allExpandedFileTreeDirectories(tree)
    collapsed.delete(src.id)

    expect(
      visibleLines(
        await renderFrame(() => (
          <DiffViewerFileTree files={files} loading={false} error={undefined} theme={theme} expandedNodes={collapsed} />
        )),
      ),
    ).toEqual(["▸ src/config", "  README.md"])

    expect(
      visibleLines(
        await renderFrame(() => (
          <DiffViewerFileTree
            files={files}
            loading={false}
            error={undefined}
            theme={theme}
            expandedNodes={allExpandedFileTreeDirectories(tree)}
          />
        )),
      ),
    ).toEqual(["▾ src/config", "    tui.ts", "  README.md"])
  })
})

async function renderFrame(component: () => JSX.Element) {
  const app = await testRender(component, { width: 40, height: 10 })
  try {
    await app.renderOnce()
    return app.captureCharFrame()
  } finally {
    app.renderer.destroy()
  }
}

function visibleLines(frame: string) {
  return frame
    .split("\n")
    .map((line) => line.trimEnd())
    .map((line) => line.replace(/^ ?│ ?/, "").replace(/[ │]*$/, ""))
    .map((line) => (line.startsWith(" ") ? line.slice(1) : line))
    .filter((line) => line.length > 0 && !/^┌|^└/.test(line))
}
