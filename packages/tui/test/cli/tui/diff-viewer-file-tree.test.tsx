/** @jsxImportSource @opentui/solid */
import { describe, expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import type { JSX } from "solid-js"
import { createTuiResolvedConfig } from "../../fixture/tui-runtime"
import { emptyThemeSource } from "../../fixture/fixture"
import { ThemeProvider } from "../../../src/context/theme"
import { ConfigProvider } from "../../../src/config"
import { DiffViewerFileTree } from "../../../src/feature-plugins/system/diff-viewer-file-tree"
import { TestTuiContexts } from "../../fixture/tui-environment"
import {
  allExpandedFileTreeDirectories,
  buildFileTree,
} from "../../../src/feature-plugins/system/diff-viewer-file-tree-utils"

describe("DiffViewerFileTree", () => {
  test("defaults to text-line file icons and triangle folders with straight rails", async () => {
    const frame = await renderFrame(() => (
      <DiffViewerFileTree
        width={32}
        files={[
          { file: "z-file.ts" },
          { file: "b/file.ts" },
          { file: "a/zeta.ts" },
          { file: "b/alpha.ts" },
          { file: "a/alpha.ts" },
        ]}
        loading={false}
        error={undefined}
      />
    ))

    expect(visibleLines(frame)).toEqual([
      "Files 0/5 reviewed",
      "▾ a",
      "│ ≡ alpha.ts ?",
      "│ ≡ zeta.ts ?",
      "▾ b",
      "│ ≡ alpha.ts ?",
      "│ ≡ file.ts ?",
      "≡ z-file.ts ?",
    ])
    expect(frame).not.toMatch(/[├└─]/)
  })

  test("keeps loading and error quiet while rendering an empty settled state", async () => {
    const loading = await renderFrame(() => (
      <DiffViewerFileTree width={32} files={[]} loading={true} error={undefined} />
    ))
    const failed = await renderFrame(() => (
      <DiffViewerFileTree width={32} files={[]} loading={false} error={new Error("nope")} />
    ))
    const empty = await renderFrame(() => (
      <DiffViewerFileTree width={32} files={[]} loading={false} error={undefined} />
    ))

    expect(loading).not.toContain("Loading diff…")
    expect(loading).not.toContain("No files")
    expect(failed).not.toContain("Failed to load diff")
    expect(failed).not.toContain("No files")
    expect(empty).toContain("No files")
    expect(
      empty
        .split("\n")
        .find((line) => line.includes("No files"))
        ?.indexOf("No files"),
    ).toBe(2)
  })

  test.each(["tree", "list"] as const)("%s layout uses two-cell horizontal sidebar padding", async (layout) => {
    const frame = await renderFrame(() => (
      <DiffViewerFileTree
        width={32}
        layout={layout}
        files={[
          { file: "src/a.ts", status: "added" },
          { file: "README.md", status: "modified" },
        ]}
        loading={false}
        error={undefined}
      />
    ))
    const lines = frame
      .split("\n")
      .slice(1)
      .filter((line) => line.trim())
    expect(lines.find((line) => line.includes("Files"))?.indexOf("Files")).toBe(2)
    const file = lines.find((line) => line.includes("README.md"))!
    expect(file.indexOf("≡")).toBe(2)
    expect(file.slice(29, 32)).toBe("M  ")
    expect(lines.every((line) => line.startsWith("  ") && line.slice(30, 32) === "  ")).toBe(true)
  })

  test.each(["dark", "light"] as const)("full top padding keeps the heading one row down in %s mode", async (mode) => {
    const frame = await renderFrame(
      () => <DiffViewerFileTree width={32} files={[{ file: "README.md" }]} loading={false} error={undefined} />,
      mode,
    )
    const lines = frame.split("\n")
    expect(lines[0].trim()).toBe("")
    expect(lines[1].indexOf("Files")).toBe(2)
    expect(lines.find((line) => line.includes("README.md"))?.indexOf("≡")).toBe(2)
  })

  test("does not render text markers for selected files", async () => {
    const files = [{ file: "src/config/tui.ts" }, { file: "README.md" }]
    const selected = visibleLines(
      await renderFrame(() => (
        <DiffViewerFileTree width={32} files={files} loading={false} error={undefined} selectedFileIndex={0} />
      )),
    )
    const unselected = visibleLines(
      await renderFrame(() => <DiffViewerFileTree width={32} files={files} loading={false} error={undefined} />),
    )

    expect(selected).toContain("▾ src/config")
    expect(unselected).toContain("▾ src/config")
    expect(selected.some((line) => line.includes("*"))).toBe(false)
    expect(unselected.some((line) => line.includes("*"))).toBe(false)
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
          <DiffViewerFileTree width={32} files={files} loading={false} error={undefined} expandedNodes={collapsed} />
        )),
      ),
    ).toEqual(["Files 0/2 reviewed", "▸ src/config", "≡ README.md ?"])

    expect(
      visibleLines(
        await renderFrame(() => (
          <DiffViewerFileTree
            files={files}
            width={32}
            loading={false}
            error={undefined}
            expandedNodes={allExpandedFileTreeDirectories(tree)}
          />
        )),
      ),
    ).toEqual(["Files 0/2 reviewed", "▾ src/config", "│ ≡ tui.ts ?", "≡ README.md ?"])
  })

  test.each(["dark", "light"] as const)(
    "file tabs distinguish duplicate basenames and review state in %s",
    async (mode) => {
      const frame = await renderFrame(
        () => (
          <DiffViewerFileTree
            width={32}
            layout="list"
            files={[
              { file: "src/sidebar.tsx", status: "added" },
              { file: "test/sidebar.tsx", status: "modified" },
            ]}
            loading={false}
            error={undefined}
            selectedFileIndex={0}
            reviewedFileNames={new Set(["src/sidebar.tsx"])}
          />
        ),
        mode,
      )
      expect(visibleLines(frame)).toEqual(["Files 1/2 reviewed", "≡ sidebar.tsx ✓", "src", "≡ sidebar.tsx M", "test"])
      expect(frame).not.toMatch(/[│├└─]/)
    },
  )

  test("keeps rows quiet: straight rails, single status letters, no hooks or dots", async () => {
    const frame = await renderFrame(() => (
      <DiffViewerFileTree
        width={32}
        files={[
          { file: "src/a.ts", status: "added" },
          { file: "src/b.ts", status: "modified" },
          { file: "test/a.ts", status: "deleted" },
        ]}
        loading={false}
        error={undefined}
      />
    ))
    const lines = visibleLines(frame)
    expect(lines).toEqual(["Files 0/3 reviewed", "▾ src", "│ ≡ a.ts A", "│ ≡ b.ts M", "▾ test", "│ ≡ a.ts D"])
    expect(frame).not.toMatch(/[├└─·]/)
    expect(frame).not.toMatch(/[\uE000-\uF8FF]/)
  })

  test("file tabs align parent paths beneath marked filenames", async () => {
    const frame = await renderFrame(() => (
      <DiffViewerFileTree
        width={32}
        layout="list"
        files={[{ file: "src/sidebar.tsx", status: "modified" }]}
        loading={false}
        error={undefined}
      />
    ))
    expect(visibleLines(frame)).toEqual(["Files 0/1 reviewed", "≡ sidebar.tsx M", "src"])
    const lines = frame.split("\n")
    expect(lines.find((line) => line.includes("src"))?.indexOf("src")).toBe(
      lines.find((line) => line.includes("sidebar.tsx"))?.indexOf("sidebar.tsx"),
    )
  })

  test("narrow collapsed chains drop whole leading segments", async () => {
    const frame = await renderFrame(() => (
      <DiffViewerFileTree
        width={26}
        files={[
          { file: "packages/tui/src/feature-plugins/system/deeply/nested/selection.ts" },
          { file: "packages/tui/src/feature-plugins/system/other/index.ts" },
        ]}
        loading={false}
        error={undefined}
      />
    ))
    const lines = visibleLines(frame)
    expect(lines).toContain("▾ …/system")
    expect(frame).not.toMatch(/\S+…\//)
  })
})

async function renderFrame(component: () => JSX.Element, mode: "dark" | "light" = "dark") {
  const app = await testRender(
    () => (
      <TestTuiContexts>
        <ConfigProvider config={createTuiResolvedConfig()}>
          <ThemeProvider mode={mode} source={emptyThemeSource}>
            {component()}
          </ThemeProvider>
        </ConfigProvider>
      </TestTuiContexts>
    ),
    { width: 40, height: 20 },
  )
  try {
    return await app.waitForFrame((frame) => frame.includes("Files"))
  } finally {
    app.renderer.destroy()
  }
}

function visibleLines(frame: string) {
  return frame
    .split("\n")
    .map((line) => line.trim().replace(/\s+/g, " "))
    .filter(Boolean)
}
