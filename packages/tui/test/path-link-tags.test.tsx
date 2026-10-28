import { expect, test } from "bun:test"
import type { SyntaxStyle } from "@opentui/core"
import { testRender, useRenderer } from "@opentui/solid"
import { generateSyntax, resolveTheme, selectTheme } from "@opencode/theme/tui"
import { getOpenCodeTheme } from "../src/theme"
import { waitForHighlightedFrame } from "./fixture/frame"

test("paints concealed path tags in the picker color after a space", async () => {
  const theme = resolveTheme(selectTheme(getOpenCodeTheme(), "dark"))
  const tagColor = theme.text.feedback.error.base
  let syntax: SyntaxStyle | undefined
  const output = await testRender(
    () => {
      const renderer = useRenderer()
      syntax = generateSyntax(theme, renderer.nativeScene, { "markup.strikethrough": tagColor })
      return (
        <markdown
          syntaxStyle={syntax}
          content={"Wrote `a.ts` ~~1~~ and `b.ts` ~~●2~~ then c.ts ~~○3~~."}
          internalBlockMode="top-level"
        />
      )
    },
    { width: 60, height: 4, remote: true },
  )

  try {
    const frame = await waitForHighlightedFrame(output, (value) =>
      value.includes("Wrote a.ts 1 and b.ts ●2 then c.ts ○3."),
    )
    expect(frame).not.toContain("~~")
    const spans = output.captureSpans().lines[0].spans
    const tags = spans.filter((span) => /^[●○]?\d$/.test(span.text))
    expect(tags.map((span) => span.text)).toEqual(["1", "●2", "○3"])
    for (const span of tags) expect(span.fg.equals(tagColor)).toBe(true)
    expect(spans[0].text).toBe("Wrote ")
    expect(spans[0].fg.equals(theme.text.base)).toBe(true)
  } finally {
    output.renderer.destroy()
    await output.renderer.closed
    syntax?.destroy()
  }
})
