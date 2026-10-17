/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import { SyntaxStyle } from "@opentui/core"
import { ManualClock } from "@opentui/core/testing"
import { testRender, useRenderer } from "@opentui/solid"
import { clickedLink } from "../../src/ui/link"

const url = "https://example.com/catalog/moparts,2004,dodge,ram+1500,4.7l+v8,1432463,brake+pad"
const syntaxStyle = SyntaxStyle.fromStyles({ default: { fg: "#ffffff" } })

test("plain clicks on any row of a wrapped Markdown link resolve the full URL", async () => {
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
    expect(opened).toEqual([url, url, url, url])
  } finally {
    app.renderer.destroy()
  }
})

test("re-clicks inside the double-click window still open the link", async () => {
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
        <box height={1} />
        <markdown syntaxStyle={syntaxStyle} content={`See ${url} now.`} />
      </box>
    )
  }
  const clock = new ManualClock()
  const app = await testRender(() => <Transcript />, { width: 32, height: 6, clock })

  try {
    for (let attempt = 0; attempt < 50 && !app.captureCharFrame().replace(/\s/g, "").includes(url); attempt++) {
      await app.renderOnce()
      await Bun.sleep(10)
    }
    const rows = app.captureCharFrame().split("\n")
    const head = rows.findIndex((row) => row.includes("https"))
    const x = rows[head]!.indexOf("https")

    clock.setTime(1000)
    await app.mockMouse.click(x + 3, head)
    clock.setTime(1200)
    await app.mockMouse.click(x + 3, head)
    expect(opened).toEqual([url, url])

    clock.setTime(1400)
    await app.mockMouse.click(x + 3, head)
    expect(opened).toEqual([url, url])
  } finally {
    app.renderer.destroy()
  }
})
