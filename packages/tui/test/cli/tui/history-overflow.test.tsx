import { afterEach, describe, expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import { SplitBorder } from "../../../src/ui/border"

let testSetup: Awaited<ReturnType<typeof testRender>> | undefined

afterEach(() => {
  testSetup?.renderer.destroy()
  testSetup = undefined
})

const WIDTH = 40
const HEIGHT = 12
const VIEWPORT = 6
const FOOTER = "FOOTER"
const BAR = SplitBorder.customBorderChars.vertical

// Mirrors a history entry: an outer box that only draws a left border, wrapping
// the message body, sitting in a scroll viewport shorter than the entry itself.
function History(props: { background?: string }) {
  return (
    <box flexDirection="column" width={WIDTH} height={HEIGHT}>
      <scrollbox height={VIEWPORT} stickyScroll={true} stickyStart="top">
        <box
          border={["left"]}
          borderColor="#cba6f7"
          customBorderChars={SplitBorder.customBorderChars}
          backgroundColor={props.background}
        >
          <box paddingLeft={2} backgroundColor="#181825">
            <text>{Array.from({ length: 20 }, (_, i) => `line ${i}`).join("\n")}</text>
          </box>
        </box>
      </scrollbox>
      <text>{FOOTER}</text>
    </box>
  )
}

async function belowViewport(background?: string) {
  testSetup = await testRender(() => <History background={background} />, { width: WIDTH, height: HEIGHT })
  await testSetup.renderOnce()
  await testSetup.renderOnce()
  return testSetup.captureCharFrame().split("\n").slice(VIEWPORT).join("\n")
}

describe("session history overflow", () => {
  // Regression: a history entry taller than the scroll viewport painted its left
  // border past the viewport, over the composer and status rows.
  test("an oversized history entry stays inside the scroll viewport", async () => {
    const below = await belowViewport("#1e1e2e")
    expect(below).toContain(FOOTER)
    expect(below).not.toContain(BAR)
  })

  // Guards the mechanism: opentui skips the scissor rect for a fully transparent
  // background, so the bordered box must declare an opaque one.
  test("a transparent background is what lets the border escape", async () => {
    const below = await belowViewport(undefined)
    expect(below).toContain(BAR)
  })
})
