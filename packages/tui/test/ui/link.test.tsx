/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import { SyntaxStyle } from "@opentui/core"
import { ManualClock } from "@opentui/core/testing"
import { testRender, useRenderer } from "@opentui/solid"
import { onCleanup } from "solid-js"
import { RGBA } from "@opentui/core"
import { clickedLink, LinkedText, linkify } from "../../src/ui/link"

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

test("linkify keeps text literal and leaves sentence punctuation out of the link", () => {
  expect(linkify("see https://example.com/a_b*c.")).toEqual([
    { text: "see " },
    { text: "https://example.com/a_b*c", href: "https://example.com/a_b*c" },
    { text: "." },
  ])
  expect(linkify("(https://example.com/x) and https://en.wikipedia.org/wiki/Foo_(bar)!")).toEqual([
    { text: "(" },
    { text: "https://example.com/x", href: "https://example.com/x" },
    { text: ")" },
    { text: " and " },
    { text: "https://en.wikipedia.org/wiki/Foo_(bar)", href: "https://en.wikipedia.org/wiki/Foo_(bar)" },
    { text: "!" },
  ])
  expect(linkify("no links, www.example.com, foohttps://example.com or https://.")).toEqual([
    { text: "no links, www.example.com, foohttps://example.com or " },
    { text: "https://." },
  ])
})

test("linkify leaves wrappers around a URL out of the link", () => {
  const href = "https://example.com/a"
  expect(linkify(`<${href}>.`)).toEqual([{ text: "<" }, { text: href, href }, { text: ">." }])
  expect(linkify(`**${href}**`)).toEqual([{ text: "**" }, { text: href, href }, { text: "**" }])
  expect(linkify(`[${href}] "${href}" '${href}'`)).toEqual([
    { text: "[" },
    { text: href, href },
    { text: "]" },
    { text: ' "' },
    { text: href, href },
    { text: '"' },
    { text: " '" },
    { text: href, href },
    { text: "'" },
  ])
  expect(linkify("https://example.com/a[0]")).toEqual([
    { text: "https://example.com/a[0]", href: "https://example.com/a[0]" },
  ])
})

test("plain clicks on any row of a wrapped URL in plain text resolve the full URL", async () => {
  const opened: string[] = []
  const color = RGBA.fromHex("#ffffff")
  function Message() {
    const renderer = useRenderer()
    return (
      <box
        onMouseUp={(event) => {
          const link = clickedLink(renderer, event)
          if (link) opened.push(link)
        }}
      >
        <LinkedText text={`See ${url}, then reply.`} fg={color} linkFg={color} />
      </box>
    )
  }
  const app = await testRender(() => <Message />, { width: 32, height: 6, clock: new ManualClock() })

  try {
    await app.renderOnce()
    const rows = app.captureCharFrame().split("\n")
    const head = rows.findIndex((row) => row.includes("https"))
    const tail = rows.findIndex((row) => row.includes("brake+pad"))
    expect(tail).toBeGreaterThan(head)

    await app.mockMouse.click(rows[head]!.indexOf("https"), head)
    await app.mockMouse.click(rows[tail]!.indexOf("brake"), tail)
    expect(opened).toEqual([url, url])

    // The comma after the URL is plain text; the URL itself contains commas, so take the last one.
    await app.mockMouse.click(rows[tail]!.lastIndexOf(","), tail)
    expect(opened).toEqual([url, url])
  } finally {
    app.renderer.destroy()
  }
})
