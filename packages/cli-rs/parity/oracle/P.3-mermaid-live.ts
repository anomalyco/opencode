// A helper for crates/mermaid/tests/all/properties.rs, not a fixture writer: renders each {source, width} of argv[2]
// with the TS plugin's code-block renderer, as P.3-mermaid.ts does, and writes argv[3] in that oracle's case shape,
// with {error} for a source the renderer throws on.
import { createTestRenderer } from "@opentui/core/testing"
import type { TextRenderable } from "@opentui/core"
import { resolveThemeDocument } from "../../../theme/src/tui/index.ts"
import { allThemes, parseTheme } from "../../../tui/src/theme/index.ts"
import { createMermaidCodeBlockRenderer } from "../../../merman/src/markdown.ts"
import { resolveOpenCodeDiagramPalette } from "../../../merman/src/palette.ts"

const input: { source: string; width: number }[] = JSON.parse(await Bun.file(process.argv[2]!).text())
const theme = resolveThemeDocument(parseTheme(allThemes().opencode, "opencode"), "dark")
const colors = resolveOpenCodeDiagramPalette(theme, "dark")
const hex = (color: { toInts(): number[] } | undefined) =>
  color
    ? color
        .toInts()
        .map((value) => value.toString(16).padStart(2, "0"))
        .join("")
    : "-"
const output: unknown[] = new Array(input.length)
for (const width of new Set(input.map((item) => item.width))) {
  const setup = await createTestRenderer({ width, height: 10 })
  const render = createMermaidCodeBlockRenderer(setup.renderer, () => ({ colors }))
  input.forEach((item, index) => {
    if (item.width !== width) return
    const context = { defaultRender: () => undefined } as unknown as Parameters<typeof render>[1]
    let diagram: TextRenderable | undefined
    try {
      diagram = render({ text: item.source } as Parameters<typeof render>[0], context) as TextRenderable | undefined
    } catch (error) {
      output[index] = { error: String(error) }
      return
    }
    if (!diagram) {
      output[index] = { lines: null }
      return
    }
    const lines: string[] = [""]
    const runs: [number, string][][] = [[]]
    for (const chunk of diagram.content.chunks) {
      chunk.text.split("\n").forEach((part, line) => {
        if (line > 0) {
          lines.push("")
          runs.push([])
        }
        if (!part) return
        lines[lines.length - 1] += part
        runs[runs.length - 1]!.push([[...part].length, `${hex(chunk.fg)} ${hex(chunk.bg)} ${chunk.attributes ?? 0}`])
      })
    }
    output[index] = { height: diagram.height, lines, runs }
    diagram.destroy()
  })
  setup.renderer.destroy()
}
await Bun.write(process.argv[3]!, JSON.stringify(output))
process.exit(0)
