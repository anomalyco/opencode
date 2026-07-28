import { afterEach, describe, expect, test } from "bun:test"
import { RGBA } from "@opentui/core"
import { testRender } from "@opentui/solid"
import { drawTabShadow } from "../../src/component/tab-shadow"

const background = RGBA.fromInts(64, 64, 64, 255)
const foreground = RGBA.fromInts(224, 224, 224, 255)
const setups: Array<Awaited<ReturnType<typeof testRender>>> = []

afterEach(() => setups.splice(0).forEach((setup) => setup.renderer.destroy()))

describe("tab shadow", () => {
  test("darkens the first content row without consuming height and follows resize", async () => {
    const setup = await testRender(
      () => (
        <box width="100%" height="100%" flexDirection="column" backgroundColor={background}>
          <box
            height={1}
            zIndex={1}
            renderAfter={function (buffer) {
              drawTabShadow(buffer, this.screenX, this.screenY + this.height, this.width, background, 0.25)
            }}
          >
            <text fg={foreground}>tabs</text>
          </box>
          <text fg={foreground} bg={background} wrapMode="none">
            content begins directly beneath the tabs
          </text>
          <text fg={foreground} bg={background}>
            unchanged
          </text>
        </box>
      ),
      { width: 40, height: 4, backgroundColor: background },
    )
    setups.push(setup)

    await setup.renderOnce()
    assertShadow(setup.captureSpans(), 40, true)

    setup.resize(24, 4)
    await setup.renderOnce()
    assertShadow(setup.captureSpans(), 24)

    setup.resize(52, 4)
    await setup.renderOnce()
    assertShadow(setup.captureSpans(), 52)
  })
})

function assertShadow(
  frame: ReturnType<(typeof setups)[number]["captureSpans"]>,
  width: number,
  assertUnchanged = false,
) {
  expect(frame.cols, "renderer width").toBe(width)
  expect(frame.lines[1].spans.map((span) => span.text).join(""), "shadow must preserve body text").toStartWith(
    "content begins directly",
  )

  const shadowed = frame.lines[1].spans
  expect(
    shadowed.reduce((total, span) => total + span.width, 0),
    "shadow width",
  ).toBe(width)
  expect(
    shadowed.every((span) => span.bg.r === background.r),
    "background-colored overlay cannot darken",
  ).toBe(true)
  expect(shadowed.find((span) => span.text.includes("content"))!.fg.r, "shadow foreground").toBeLessThan(foreground.r)

  if (assertUnchanged) {
    const unchanged = frame.lines[2].spans
    expect(
      unchanged.some((span) => span.text.includes("unchanged") && span.fg.r === foreground.r),
      "next row unchanged",
    ).toBe(true)
  }
}
