import { afterEach, expect, test } from "bun:test"
import { RGBA, type TextChunk } from "@opentui/core"
import { testRender, type JSX } from "@opentui/solid"
import { StyledOutput } from "../../../src/routes/session"

let setup: Awaited<ReturnType<typeof testRender>> | undefined

afterEach(() => {
  setup?.renderer.destroy()
  setup = undefined
})

const output = JSON.stringify(
  {
    p: "/console/u/0/developers/billing/projects/an-unusually-long-project-identifier/users-and-permissions/invite",
    els: ['- textbox "user@example.com" [ref=e174]', '- button "Send invite" [ref=e181]'],
    count: 2,
    ok: true,
  },
  null,
  2,
)
const fg = RGBA.fromHex("#eeeeee")

// Every token its own chunk, as the highlighter splits JSON.
function chunks(): TextChunk[] {
  return output.split(/(\s+|[{}[\]:,])/).map((text, index) => ({
    __isChunk: true,
    text,
    fg: RGBA.fromHex(index % 3 === 0 ? "#fab283" : "#7fd88f"),
  }))
}

async function frame(width: number, node: () => JSX.Element) {
  setup?.renderer.destroy()
  setup = await testRender(() => <box paddingLeft={3}>{node()}</box>, { width, height: 40 })
  await setup.renderOnce()
  return setup.captureCharFrame()
}

for (const width of [40, 80, 160]) {
  test(`colored output wraps exactly like the plain text at ${width} columns`, async () => {
    const plain = await frame(width, () => <text fg={fg}>{output}</text>)
    const unstyled = await frame(width, () => <StyledOutput content={output} fg={fg} />)
    const colored = await frame(width, () => <StyledOutput content={output} chunks={chunks()} fg={fg} />)
    expect(unstyled).toBe(plain)
    expect(colored).toBe(plain)
    expect(plain).toContain('"count": 2')
  })
}
