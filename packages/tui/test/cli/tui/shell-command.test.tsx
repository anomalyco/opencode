import { afterEach, expect, test } from "bun:test"
import { RGBA } from "@opentui/core"
import { testRender, type JSX } from "@opentui/solid"
import { CommandSpans } from "../../../src/routes/session"

let setup: Awaited<ReturnType<typeof testRender>> | undefined

afterEach(() => {
  setup?.renderer.destroy()
  setup = undefined
})

const command =
  "cp ./tmp/op13-keyguard-check.png /home/nowaker/projekty/modern/worldmodern/.vibeterm/tmp/./tmp/op13-keyguard-check.png /home/nowaker/projekty/modern/worldmodern/.vibeterm/tmp/opencode/op13-keyguard-check.png 2>&1"
const text = RGBA.fromHex("#eeeeee")

async function frame(width: number, node: () => JSX.Element) {
  setup?.renderer.destroy()
  setup = await testRender(() => <box paddingLeft={3}>{node()}</box>, { width, height: 12 })
  await setup.renderOnce()
  return setup.captureCharFrame()
}

// Every token its own span, the way the highlighter splits a command.
function segments() {
  return command.split(/(\s+)/).map((token, index) => ({
    text: token,
    fg: RGBA.fromHex(index % 4 === 0 ? "#61afef" : "#7fd88f"),
  }))
}

for (const width of [40, 80, 160]) {
  test(`a colored command wraps exactly like the plain one at ${width} columns`, async () => {
    const plain = await frame(width, () => <text fg={text}>$ {command}</text>)
    const colored = await frame(width, () => (
      <text fg={text}>
        $ <CommandSpans segments={segments()} />
      </text>
    ))
    expect(colored).toBe(plain)
    expect(plain).toContain("$ cp ./tmp/op13-keyguard-check.png")
  })
}
