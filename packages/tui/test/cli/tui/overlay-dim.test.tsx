/** @jsxImportSource @opentui/solid */
import { testRender, type JSX } from "@opentui/solid"
import { RGBA } from "@opentui/core"
import { expect, test } from "bun:test"
import { overlayDim } from "../../../src/ui/overlay-dim"

async function captureWithOverlay(overlay: () => JSX.Element) {
  const app = await testRender(
    () => (
      <box width={80} height={24} paddingLeft={1} paddingTop={1}>
        <text>你好世界中文测试</text>
        {overlay()}
      </box>
    ),
    { width: 80, height: 24 },
  )
  try {
    await app.renderOnce()
    await app.renderOnce()
    return app.captureCharFrame()
  } finally {
    app.renderer.destroy()
  }
}

test("translucent background overlay erases wide CJK glyphs", async () => {
  const frame = await captureWithOverlay(() => (
    <box
      position="absolute"
      left={0}
      top={0}
      width={80}
      height={24}
      backgroundColor={RGBA.fromInts(0, 0, 0, 150)}
    />
  ))
  expect(frame).not.toContain("你")
})

test("color matrix overlay keeps wide CJK glyphs visible", async () => {
  const frame = await captureWithOverlay(() => (
    <box position="absolute" left={0} top={0} width={80} height={24} renderAfter={overlayDim(150)} />
  ))
  expect(frame).toContain("你")
  expect(frame).toContain("测试")
})
