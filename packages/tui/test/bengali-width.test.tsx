import { expect, test } from "bun:test"
import { createTestRenderer, setRendererCapabilities } from "@opentui/core/testing"
import { render } from "@opentui/solid"

test("keeps wide Bengali graphemes inside a bordered panel", async () => {
  const setup = await createTestRenderer({ width: 24, height: 8, useThread: false })
  setRendererCapabilities(setup.renderer, { unicode: "unicode-wide" })

  try {
    await render(
      () => (
        <box width="100%" height="100%" border>
          <text>বাংলা ভাষায় কথা বলি বাংলা</text>
          <text>ASCII abc</text>
          <text>中文</text>
        </box>
      ),
      setup.renderer,
    )
    await setup.renderOnce()

    const wide = [
      "┌──────────────────────┐",
      "│বাংলা ভাষায় কথা বলি    │",
      "│বাংলা                  │",
      "│ASCII abc             │",
      "│中文                  │",
      "│                      │",
      "│                      │",
      "└──────────────────────┘",
    ].join("\n")
    expect(setup.renderer.widthMethod).toBe("unicode-wide")
    expect(setup.captureCharFrame().trimEnd()).toBe(wide)

    await setup.renderOnce()
    expect(setup.captureCharFrame().trimEnd()).toBe(wide)

    setup.resize(18, 8)
    await setup.renderOnce()
    expect(setup.captureCharFrame().trimEnd()).toBe(
      [
        "┌────────────────┐",
        "│বাংলা ভাষায় কথা  │",
        "│বলি বাংলা        │",
        "│ASCII abc       │",
        "│中文            │",
        "│                │",
        "│                │",
        "└────────────────┘",
      ].join("\n"),
    )
  } finally {
    setup.renderer.destroy()
  }
})
