import { afterEach, expect, test } from "bun:test"
import { RGBA } from "@opentui/core"
import { testRender } from "@opentui/solid"
import { ToolInput } from "../../../src/routes/session"
import { formatToolInput } from "../../../src/util/tool-input"

let setup: Awaited<ReturnType<typeof testRender>> | undefined

afterEach(() => {
  setup?.renderer.destroy()
  setup = undefined
})

const color = RGBA.fromHex("#ffffff")
const colors = {
  indent: color,
  key: color,
  punctuation: color,
  string: color,
  number: color,
  boolean: color,
  null: color,
  fold: color,
}

const input = {
  questions: [
    {
      header: "Paste dialog v4",
      question:
        "Live as vt-233 on desktop and m4max (fork 00ea612cb9, PR #54463 updated). This tab has to restart before the dialog shows, and the other tabs pick it up the next time they start.",
      options: [
        { label: "Works", description: "Buttons, tab and hint behave as listed in the report" },
        { label: "Something's off", description: "Say what" },
      ],
    },
  ],
}

async function frame(width: number, collapsedWidth?: number) {
  setup?.renderer.destroy()
  const { rows } = formatToolInput(input, collapsedWidth)
  let reported: number | undefined
  setup = await testRender(
    () => (
      <box paddingLeft={3}>
        <ToolInput rows={rows} colors={colors} onWidth={(value) => (reported = value)} />
      </box>
    ),
    { width, height: 30 },
  )
  await setup.renderOnce()
  const lines = setup
    .captureCharFrame()
    .split("\n")
    .map((line) => line.trimEnd())
    .filter(Boolean)
  return { lines, reported }
}

for (const width of [40, 80, 160]) {
  test(`collapsed at ${width} columns, every value fills exactly one row`, async () => {
    const measured = (await frame(width)).reported!
    expect(measured).toBe(width - 3)
    const { lines } = await frame(width, measured)
    expect(lines.map((line) => line.trimStart().split(":")[0])).toEqual([
      "questions",
      "- header",
      "question",
      "options",
      "- label",
      "description",
      "- label",
      "description",
    ])
    expect(lines.every((line) => Bun.stringWidth(line) <= width)).toBe(true)
    expect(lines[2]).toEndWith("…")
    expect(lines[2].startsWith("     question: Live as vt-233")).toBe(true)
  })
}

test("expanded, wraps long values and keeps compact YAML indents", async () => {
  const { lines } = await frame(80)
  expect(lines.slice(0, 3)).toEqual([
    "   questions:",
    "   - header: Paste dialog v4",
    "     question: Live as vt-233 on desktop and m4max (fork 00ea612cb9, PR #54463",
  ])
  expect(lines.length).toBeGreaterThan(8)
})
