/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import { MouseEvent, SyntaxStyle, type CliRenderer } from "@opentui/core"
import { ManualClock } from "@opentui/core/testing"
import { testRender, useRenderer } from "@opentui/solid"
import { onCleanup } from "solid-js"
import { clickedLink } from "../../src/ui/link"

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
    await app.mockMouse.click(x, head, 0, { modifiers: { alt: true } })
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

test("clicks with any reported modifier never resolve a link", () => {
  // clickedLink only reads these two renderer methods; keep the guard test independent of renderer state.
  const renderer = {
    getSelection: () => ({ isStart: true, behavior: "cell" }),
    getLinkAt: () => url,
  } as unknown as CliRenderer
  const click = (modifiers: MouseEvent["modifiers"]) =>
    new MouseEvent(null, { type: "up", button: 0, x: 0, y: 0, modifiers, isDragging: true })

  expect(clickedLink(renderer, click({ shift: false, alt: false, ctrl: false }))).toBe(url)
  expect(clickedLink(renderer, click({ shift: true, alt: false, ctrl: false }))).toBeUndefined()
  expect(clickedLink(renderer, click({ shift: false, alt: true, ctrl: false }))).toBeUndefined()
  expect(clickedLink(renderer, click({ shift: false, alt: false, ctrl: true }))).toBeUndefined()
  // The pinned OpenTUI MouseEvent type does not declare meta yet, but terminals that report
  // Cmd/Super send it at runtime and it must not fall through to the local-file opener.
  expect(
    clickedLink(renderer, click({ shift: false, alt: false, ctrl: false, meta: true } as MouseEvent["modifiers"])),
  ).toBeUndefined()
})
