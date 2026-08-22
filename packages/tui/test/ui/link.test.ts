import { expect, test } from "bun:test"
import { StyledText, TextRenderable } from "@opentui/core"
import { createTestRenderer, setRendererCapabilities } from "@opentui/core/testing"
import { linkAt } from "../../src/ui/link"

test("resolves terminal hyperlink metadata at the clicked cell", async () => {
  const app = await createTestRenderer({ width: 60, height: 4 })
  setRendererCapabilities(app.renderer, { hyperlinks: true })
  const href = "file:///tmp/example.ts#L12"
  app.renderer.root.add(
    new TextRenderable(app.renderer, {
      content: new StyledText([{ __isChunk: true, text: "example", link: { url: href } }]),
      width: "100%",
      height: 1,
    }),
  )

  try {
    await app.waitForFrame((frame) => frame.includes("example"))
    const buffer = app.renderer.currentRenderBuffer
    const links = Array.from({ length: buffer.width * buffer.height }, (_, index) =>
      linkAt(buffer, index % buffer.width, Math.floor(index / buffer.width)),
    )
    expect(links).toContain(href)
  } finally {
    app.renderer.destroy()
  }
})
