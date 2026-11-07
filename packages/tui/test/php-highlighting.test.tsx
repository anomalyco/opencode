import { afterAll, expect, test } from "bun:test"
import { addDefaultParsers, CodeRenderable, TreeSitterClient, type Renderable } from "@opentui/core"
import { testRender } from "@opentui/solid"
import { ConfigProvider } from "../src/config"
import { ThemeProvider, useTheme, useThemes } from "../src/context/theme"
import parsers from "../src/parsers-config"
import { emptyThemeSource, tmpdir } from "./fixture/fixture"
import { TestTuiContexts } from "./fixture/tui-environment"
import { createTuiResolvedConfig } from "./fixture/tui-runtime"

addDefaultParsers(parsers.parsers)
const data = await tmpdir()
const client = new TreeSitterClient({ dataPath: data.path })

afterAll(async () => {
  await client.destroy()
  await data[Symbol.asyncDispose]()
})

const snippet = [
  "$compiled = parent::getCompiledPath($path);",
  "",
  "if ($this->echoFormat === self::DEFAULT_ECHO_FORMAT) {",
  "    return $compiled;",
  "}",
].join("\n")

const content = [
  "Without the tag:",
  "",
  "```php",
  snippet,
  "```",
  "",
  "With the tag:",
  "",
  "```php",
  "<?php",
  snippet,
  "```",
].join("\n")

test("highlights PHP fenced blocks both without and with an opening <?php tag", async () => {
  const output = await testRender(
    () => (
      <TestTuiContexts>
        <ConfigProvider config={createTuiResolvedConfig({ animations: false })}>
          <ThemeProvider mode="dark" source={emptyThemeSource}>
            <Body />
          </ThemeProvider>
        </ConfigProvider>
      </TestTuiContexts>
    ),
    { width: 80, height: 24, remote: true },
  )

  try {
    await output.renderOnce()
    await Promise.all(codeBlocks(output.renderer.root).map((node) => node.highlightingDone))
    await output.renderOnce()

    const lines = output.captureSpans().lines
    const prose = lines.find((line) => line.spans.some((span) => span.text.includes("Without the tag:")))
    const openTag = lines.find((line) => line.spans.some((span) => span.text.includes("<?php")))
    expect(prose).toBeDefined()
    expect(openTag).toBeDefined()

    const proseColor = prose!.spans.find((span) => span.text.includes("Without the tag:"))!.fg.toInts()
    const tagColor = openTag!.spans.find((span) => span.text.includes("<?php"))!.fg.toInts()
    expect(tagColor).not.toEqual(proseColor)

    for (const needle of [
      "$compiled = parent::getCompiledPath($path);",
      "if ($this->echoFormat === self::DEFAULT_ECHO_FORMAT) {",
      "return $compiled;",
    ]) {
      const matches = lines.filter((line) =>
        line.spans
          .map((span) => span.text)
          .join("")
          .includes(needle),
      )
      expect(matches).toHaveLength(2)

      const bare = lineSignature(matches[0]!.spans)
      const tagged = lineSignature(matches[1]!.spans)
      expect(new Set(tagged.map((span) => span.fg.join(","))).size).toBeGreaterThan(1)
      expect(bare).toEqual(tagged)
    }
  } finally {
    output.renderer.destroy()
    await output.renderer.closed
  }
})

function Body() {
  const theme = useTheme()
  const themes = useThemes()
  return (
    <markdown
      syntaxStyle={themes.currentSyntax()}
      content={content}
      streaming={false}
      internalBlockMode="top-level"
      conceal
      fg={theme.markdown.text}
      bg={theme.background.base}
      treeSitterClient={client}
    />
  )
}

function codeBlocks(node: Renderable): CodeRenderable[] {
  return [...(node instanceof CodeRenderable ? [node] : []), ...node.getChildren().flatMap(codeBlocks)]
}

function lineSignature(spans: ReadonlyArray<{ text: string; fg: { toInts(): number[] } }>) {
  return spans.flatMap((span) => {
    const text = span.text.trim()
    return text.length > 0 ? [{ text, fg: span.fg.toInts() }] : []
  })
}
