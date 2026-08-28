/** @jsxImportSource @opentui/solid */
import { CodeRenderable, type Renderable, type ScrollBoxRenderable } from "@opentui/core"
import { testRender, useKeyboard } from "@opentui/solid"
import { For } from "solid-js"
import { PatchDiff } from "../src/component/patch-diff"
import { ConfigProvider } from "../src/config"
import { ThemeProvider, useThemes } from "../src/context/theme"
import { TestTuiContexts } from "../test/fixture/tui-environment"
import { emptyThemeSource } from "../test/fixture/fixture"
import { largeDiffFixture } from "../test/fixture/large-diff"
import { createTuiResolvedConfig } from "../test/fixture/tui-runtime"

const kind = process.argv[2] ?? "hunks"
if (kind !== "hunks" && kind !== "lines" && kind !== "long") throw new Error("Use hunks, lines, or long")
const count = Number(process.argv[3] ?? (kind === "hunks" ? 1000 : 20000))
const width = Number(process.env.DIFF_BENCH_WIDTH ?? 160)
const files = Number(process.env.DIFF_BENCH_FILES ?? 1)
const iterations = Number(process.env.DIFF_BENCH_RUNS ?? 7)
const fixture = largeDiffFixture(kind, count)
const results: { ready: number; scroll: number[]; rss: number }[] = []

for (let iteration = 0; iteration <= iterations; iteration++) {
  let scroll: ScrollBoxRenderable | undefined
  function Content() {
    const themes = useThemes()
    const theme = themes.current
    useKeyboard((key) => {
      if (key.name === "j") scroll?.scrollBy(1)
    })
    return (
      <scrollbox
        ref={(node: ScrollBoxRenderable) => (scroll = node)}
        width="100%"
        height="100%"
        verticalScrollbarOptions={{ visible: false }}
      >
        <For each={Array.from({ length: files }, (_, index) => index)}>
          {() => (
            <box>
              <PatchDiff
                diff={fixture.patch}
                view={width >= 100 ? "split" : "unified"}
                width="100%"
                wrapMode="char"
                filetype={process.env.DIFF_BENCH_SYNTAX ? "json" : undefined}
                syntaxStyle={themes.currentSyntax()}
                showLineNumbers
                hunkFg={theme.diff.text.hunkHeader}
                fg={theme.text.default}
                addedBg={theme.diff.background.added}
                removedBg={theme.diff.background.removed}
                contextBg={theme.diff.background.context}
                addedSignColor={theme.diff.highlight.added}
                removedSignColor={theme.diff.highlight.removed}
                lineNumberFg={theme.diff.lineNumber.text}
                lineNumberBg={theme.diff.background.context}
                addedLineNumberBg={theme.diff.lineNumber.background.added}
                removedLineNumberBg={theme.diff.lineNumber.background.removed}
              />
            </box>
          )}
        </For>
      </scrollbox>
    )
  }
  const started = performance.now()
  const app = await testRender(
    () => (
      <TestTuiContexts>
        <ConfigProvider config={createTuiResolvedConfig()}>
          <ThemeProvider mode="dark" source={emptyThemeSource}>
            <Content />
          </ThemeProvider>
        </ConfigProvider>
      </TestTuiContexts>
    ),
    { width, height: 30 },
  )
  try {
    await app.flush()
    const ready = performance.now() - started
    if (!scroll) throw new Error("Missing patch viewport")
    scroll.scrollTo(scroll.scrollHeight)
    await app.flush()
    const code = kind === "long" ? codeNodes(app.renderer.root).at(-1) : undefined
    if (kind === "long" && !code) throw new Error("Missing diff code owner")
    const frame = app.captureCharFrame()
    // A long marker may cross wrap rows; reconstruct its pane without interleaving the other side.
    const visible = code
      ? frame
          .split("\n")
          .map((line) => line.slice(code.x, code.x + code.width))
          .join("")
          .replace(/\s/g, "")
      : frame
    if (!visible.includes(fixture.tail)) throw new Error("The end of the full diff is not accessible")
    scroll.scrollTo(Math.floor(scroll.scrollHeight / 2))
    await app.flush()
    const frames: number[] = []
    for (let frame = 0; frame < 20; frame++) {
      const started = performance.now()
      app.mockInput.pressKey("j")
      await app.renderOnce()
      frames.push(performance.now() - started)
    }
    const result = { ready, scroll: frames, rss: process.memoryUsage().rss }
    if (iteration > 0) results.push(result)
    console.log(
      JSON.stringify({
        iteration,
        warmup: iteration === 0,
        ready_ms: ready,
        scroll_p95_ms: percentile(frames, 0.95),
        rss_bytes: result.rss,
      }),
    )
  } finally {
    app.renderer.destroy()
    Bun.gc(true)
  }
}

console.log(
  JSON.stringify({
    kind,
    count,
    width,
    files,
    iterations,
    ready_median_ms: percentile(
      results.map((result) => result.ready),
      0.5,
    ),
    ready_min_ms: percentile(
      results.map((result) => result.ready),
      0,
    ),
    ready_max_ms: percentile(
      results.map((result) => result.ready),
      1,
    ),
    scroll_p95_ms: percentile(
      results.flatMap((result) => result.scroll),
      0.95,
    ),
    scroll_max_ms: percentile(
      results.flatMap((result) => result.scroll),
      1,
    ),
    rss_max_bytes: percentile(
      results.map((result) => result.rss),
      1,
    ),
  }),
)
console.log(
  `METRIC diff_ready_ms=${percentile(
    results.map((result) => result.ready),
    0.5,
  ).toFixed(2)}`,
)
console.log(
  `METRIC diff_scroll_p95_ms=${percentile(
    results.flatMap((result) => result.scroll),
    0.95,
  ).toFixed(2)}`,
)

function percentile(values: number[], fraction: number) {
  return [...values].sort((left, right) => left - right)[Math.ceil((values.length - 1) * fraction)]
}

function codeNodes(root: Renderable): CodeRenderable[] {
  return root instanceof CodeRenderable ? [root] : root.getChildren().flatMap(codeNodes)
}
