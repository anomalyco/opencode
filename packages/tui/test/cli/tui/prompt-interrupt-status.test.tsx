/** @jsxImportSource @opentui/solid */
import { RGBA } from "@opentui/core"
import { testRender } from "@opentui/solid"
import { expect, test } from "bun:test"
import { PromptInterruptStatus } from "../../../src/component/prompt"

test("armed interrupt status renders visible warning text", async () => {
  const text = RGBA.fromHex("#ffffff")
  const subdued = RGBA.fromHex("#808080")
  const warning = RGBA.fromHex("#fbbf24")
  const app = await testRender(() => <PromptInterruptStatus armed text={text} subdued={subdued} warning={warning} />, {
    width: 30,
    height: 1,
  })

  try {
    await app.renderOnce()
    const line = app.renderer.currentRenderBuffer.getSpanLines()[0]!

    expect(line.spans.map((span) => span.text).join("")).toContain("esc again to interrupt")
    expect(line.spans.filter((span) => span.text.trim()).every((span) => span.fg.equals(warning))).toBeTrue()
  } finally {
    app.renderer.destroy()
  }
})
