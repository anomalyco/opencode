// P-ORACLE for P.3: every Mermaid source in the merman tests, rendered by the TypeScript plugin's own code-block
// renderer (`createMermaidCodeBlockRenderer`, as `plugin.ts` registers it) with the `opencode` dark palette at a
// few terminal widths. Writes parity/fixtures/P.3/corpus.json; crates/mermaid/tests/oracle.rs renders the same
// sources in Rust and compares the styled lines.
//
// The corpus is each template literal in packages/merman/src/**/*.test.ts and the layout-audit fixtures whose
// first meaningful line names a diagram kind; literals with `${` interpolations are skipped. A case renders as
// `null` when TS keeps the fence as code. Lines are strings; `runs` holds per line [code points, style index]
// pairs into `styles`, each "fg bg attributes" with colors as rrggbbaa or "-" when unset.
import { createTestRenderer } from "@opentui/core/testing"
import type { TextRenderable } from "@opentui/core"
import { resolveThemeDocument } from "../../../theme/src/tui/index.ts"
import { allThemes, parseTheme } from "../../../tui/src/theme/index.ts"
import { createMermaidCodeBlockRenderer } from "../../../merman/src/markdown.ts"
import { resolveOpenCodeDiagramPalette } from "../../../merman/src/palette.ts"
import { detectMermaidDiagram } from "../../../merman/src/detect.ts"

const WIDTHS = [120, 60]
const root = new URL("../../../merman/src/", import.meta.url).pathname
const output = new URL("../fixtures/P.3/corpus.json", import.meta.url).pathname

const files = [
  ...Array.from(new Bun.Glob("**/*.test.ts").scanSync({ cwd: root })),
  "test/layout-audit/fixtures.ts",
].sort()
const sources = new Set<string>()
for (const file of files) {
  const text = await Bun.file(`${root}${file}`).text()
  for (const match of text.matchAll(/`((?:[^`\\]|\\.)*)`/g)) {
    const body = match[1]!
    if (body.includes("${")) continue
    // Template literals keep escapes such as \` and \\ as written.
    const source = body.replace(/\\([`\\$])/g, "$1")
    if (detectMermaidDiagram(source)) sources.add(source)
  }
}

const theme = resolveThemeDocument(parseTheme(allThemes().opencode, "opencode"), "dark")
const colors = resolveOpenCodeDiagramPalette(theme, "dark")
const styles = new Map<string, number>()
const hex = (color: { toInts(): number[] } | undefined) =>
  color
    ? color
        .toInts()
        .map((value) => value.toString(16).padStart(2, "0"))
        .join("")
    : "-"

const cases: unknown[] = []
for (const width of WIDTHS) {
  const setup = await createTestRenderer({ width, height: 10 })
  const render = createMermaidCodeBlockRenderer(setup.renderer, () => ({ colors }))
  for (const source of sources) {
    const context = { defaultRender: () => undefined } as unknown as Parameters<typeof render>[1]
    const diagram = render({ text: source } as Parameters<typeof render>[0], context) as TextRenderable | undefined
    if (!diagram) {
      cases.push({ width, source, lines: null })
      continue
    }
    const lines: string[] = [""]
    const runs: [number, number][][] = [[]]
    for (const chunk of diagram.content.chunks) {
      const parts = chunk.text.split("\n")
      parts.forEach((part, index) => {
        if (index > 0) {
          lines.push("")
          runs.push([])
        }
        if (!part) return
        const key = `${hex(chunk.fg)} ${hex(chunk.bg)} ${chunk.attributes ?? 0}`
        const style = styles.get(key) ?? styles.set(key, styles.size).get(key)!
        lines[lines.length - 1] += part
        runs[runs.length - 1]!.push([[...part].length, style])
      })
    }
    cases.push({ width, source, height: diagram.height, lines, runs })
    diagram.destroy()
  }
  setup.renderer.destroy()
}

const text = [
  "{",
  `  "styles": ${JSON.stringify([...styles.keys()])},`,
  `  "cases": [\n${cases.map((item) => `    ${JSON.stringify(item)}`).join(",\n")}\n  ]`,
  "}",
  "",
].join("\n")
await Bun.write(output, text)
console.log(`oracle: P.3 ${cases.length} cases from ${sources.size} sources`)
