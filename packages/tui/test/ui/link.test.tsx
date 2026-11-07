/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import { SyntaxStyle } from "@opentui/core"
import { ManualClock } from "@opentui/core/testing"
import { testRender, useRenderer } from "@opentui/solid"
import { onCleanup } from "solid-js"
import { clickedLink, LinkedText } from "../../src/ui/link"

const url = "https://example.com/catalog/moparts,2004,dodge,ram+1500,4.7l+v8,1432463,brake+pad"

test("plain clicks on any row of a wrapped Markdown link resolve the full URL", async () => {
  const opened: string[] = []
  function Transcript() {
    const renderer = useRenderer()
    const syntaxStyle = SyntaxStyle.fromStyles({ default: { fg: "#ffffff" } }, renderer.nativeScene)
    onCleanup(() => syntaxStyle.destroy())
    return (
      <box
        onMouseUp={(event) => {
          const link = clickedLink(renderer, event)
          if (link) opened.push(link)
        }}
      >
        <box height={1} />
        <markdown syntaxStyle={syntaxStyle} content={`See ${url} now.`} />
      </box>
    )
  }
  const app = await testRender(() => <Transcript />, { width: 32, height: 6, clock: new ManualClock() })

  try {
    for (let attempt = 0; attempt < 50 && !app.captureCharFrame().replace(/\s/g, "").includes(url); attempt++) {
      await app.renderOnce()
      await Bun.sleep(10)
    }
    const rows = app.captureCharFrame().split("\n")
    const head = rows.findIndex((row) => row.includes("https"))
    const tail = rows.findIndex((row) => row.includes("brake+pad"))
    const x = rows[head]!.indexOf("https")
    expect(tail).toBeGreaterThan(head)

    await app.mockMouse.click(x, head)
    await app.mockMouse.click(rows[tail]!.indexOf("brake"), tail)
    expect(opened).toEqual([url, url])

    await app.mockMouse.click(0, head)
    await app.mockMouse.click(x, head, 0, { modifiers: { ctrl: true } })
    await app.mockMouse.click(x, head, 0, { modifiers: { shift: true } })
    await app.mockMouse.click(x, head, 2)
    await app.mockMouse.drag(0, head, x + 2, head)
    await app.mockMouse.drag(0, 0, x + 2, head)
    expect(opened).toEqual([url, url])

    await app.mockMouse.click(rows[tail]!.indexOf("brake"), tail)
    await app.mockMouse.click(rows[tail]!.indexOf("brake"), tail)
    expect(opened).toEqual([url, url, url])
  } finally {
    app.renderer.destroy()
  }
})

test("LinkedText renders links and clicks resolve via clickedLink", async () => {
  const opened: string[] = []
  function Transcript() {
    const renderer = useRenderer()
    return (
      <box
        onMouseUp={(event) => {
          const link = clickedLink(renderer, event)
          if (link) opened.push(link)
        }}
      >
        <text>
          <LinkedText text="Check [Docs](https://example.com/docs) and https://example.com/bare!" linkFg="#58a6ff" />
        </text>
      </box>
    )
  }
  const app = await testRender(() => <Transcript />, { width: 80, height: 4, clock: new ManualClock() })

  try {
    await app.renderOnce()
    const frame = app.captureCharFrame()
    expect(frame).toContain("Check [Docs](https://example.com/docs) and https://example.com/bare!")

    // Click on "https://example.com/docs" (starts at index 13)
    await app.mockMouse.click(20, 0)
    expect(opened).toEqual(["https://example.com/docs"])

    // Click on "https://example.com/bare" (starts at index 43)
    await app.mockMouse.click(50, 0)
    expect(opened).toEqual(["https://example.com/docs", "https://example.com/bare"])

    // Click on non-link text "Check"
    await app.mockMouse.click(0, 0)
    expect(opened).toEqual(["https://example.com/docs", "https://example.com/bare"])

    // Click on "[Docs]" label text (which is not converted to a link)
    await app.mockMouse.click(8, 0)
    expect(opened).toEqual(["https://example.com/docs", "https://example.com/bare"])

    // Click on trailing punctuation "!"
    await app.mockMouse.click(67, 0)
    expect(opened).toEqual(["https://example.com/docs", "https://example.com/bare"])
  } finally {
    app.renderer.destroy()
  }
})

test("LinkedText supports plain text without links", async () => {
  const app = await testRender(
    () => (
      <box>
        <text>
          <LinkedText text="Just a normal message without any links." />
        </text>
      </box>
    ),
    { width: 50, height: 3, clock: new ManualClock() },
  )

  try {
    await app.renderOnce()
    expect(app.captureCharFrame()).toContain("Just a normal message without any links.")
  } finally {
    app.renderer.destroy()
  }
})
