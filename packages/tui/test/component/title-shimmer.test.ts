import { expect, test } from "bun:test"
import { BoxRenderable, RGBA, TextAttributes, TextRenderable } from "@opentui/core"
import { createTestRenderer, ManualClock } from "@opentui/core/testing"
import { TitleShimmerRenderable } from "../../src/component/title-shimmer"

test("pending shimmer changes colors, not text, and stops on unchanged completion", async () => {
  const clock = new ManualClock()
  const app = await createTestRenderer({ width: 24, height: 1, useThread: false, clock })
  const title = new TitleShimmerRenderable(app.renderer, {
    width: 24,
    height: 1,
    content: "Compiler cleanup",
    fg: "#eeeeee",
    backdrop: RGBA.fromHex("#111111"),
    rename: { title: "Compiler cleanup", pending: true },
  })
  app.renderer.root.add(title)
  try {
    await app.renderOnce()
    const frame = app.captureCharFrame()
    const colors = app.captureSpans()
    clock.advance(600)
    await app.renderOnce()
    expect(app.captureSpans()).not.toEqual(colors)
    expect(app.captureCharFrame()).toBe(frame)
    title.rename = { title: "Compiler cleanup", pending: false }
    await app.renderOnce()
    expect(app.renderer.root.liveCount).toBe(0)
    title.enabled = false
    title.rename = { title: "Compiler cleanup", pending: true }
    await app.renderOnce()
    expect(app.renderer.root.liveCount).toBe(0)
  } finally {
    app.renderer.destroy()
  }
})

test("arrival replaces old text with new text across a clean wipe, without a comet", async () => {
  const clock = new ManualClock()
  const app = await createTestRenderer({ width: 16, height: 1, useThread: false, clock })
  const title = new TitleShimmerRenderable(app.renderer, {
    width: 16,
    height: 1,
    content: "ABCDEFGHIJKLMNOP",
    fg: "#eeeeee",
    attributes: TextAttributes.ITALIC,
    backdrop: RGBA.fromHex("#111111"),
    rename: { title: "ABCDEFGHIJKLMNOP", pending: true },
  })
  app.renderer.root.add(title)
  try {
    await app.renderOnce()
    title.content = "abcdefghijklmnop"
    title.rename = { title: "abcdefghijklmnop", pending: true }
    await app.renderOnce()
    expect(app.captureCharFrame().trim()).toBe("ABCDEFGHIJKLMNOP")
    clock.advance(225)
    await app.renderOnce()
    expect(app.captureCharFrame().trim()).toBe("abcdefghIJKLMNOP")
    expect(
      app
        .captureSpans()
        .lines[0].spans.every(
          (span) => span.fg.equals(RGBA.fromHex("#eeeeee")) && Boolean(span.attributes & TextAttributes.ITALIC),
        ),
    ).toBe(true)
    clock.advance(225)
    await app.renderOnce()
    expect(app.captureCharFrame().trim()).toBe("abcdefghijklmnop")
    expect(app.renderer.root.liveCount).toBe(0)

    title.rename = { title: "abcdefghijklmnop", pending: false }
    title.content = "Manual"
    title.rename = { title: "Manual", pending: false }
    await app.renderOnce()
    expect(app.captureCharFrame().trim()).toBe("Manual")
    expect(app.renderer.root.liveCount).toBe(0)

    title.rename = { title: "Manual", pending: true }
    await app.renderOnce()
    title.content = "Next"
    title.rename = { title: "Next", pending: false }
    title.enabled = false
    await app.renderOnce()
    expect(app.captureCharFrame().trim()).toBe("Next")
    title.enabled = true
    expect(app.renderer.root.liveCount).toBe(0)
  } finally {
    app.renderer.destroy()
  }
})

test("native Unicode clipping and shorter replacement leave no split glyphs or old tail", async () => {
  const clock = new ManualClock()
  const app = await createTestRenderer({ width: 24, height: 3, useThread: false, clock })
  const content = "A\u65e5B \u{1f680} cafe\u0301"
  const title = new TitleShimmerRenderable(app.renderer, {
    width: 20,
    height: 1,
    content,
    fg: "#eeeeee",
    wrapMode: "none",
    backdrop: RGBA.fromHex("#111111"),
    rename: { title: content, pending: true },
  })
  const plain = new TextRenderable(app.renderer, { width: 20, height: 1, content, wrapMode: "none" })
  const shadedBox = new BoxRenderable(app.renderer, { width: 6, height: 1, marginLeft: 2, overflow: "hidden" })
  const plainBox = new BoxRenderable(app.renderer, { width: 6, height: 1, marginLeft: 2, overflow: "hidden" })
  shadedBox.add(title)
  plainBox.add(plain)
  app.renderer.root.add(shadedBox)
  app.renderer.root.add(plainBox)
  app.renderer.root.add(new TextRenderable(app.renderer, { content: "untouched" }))
  try {
    await app.renderOnce()
    expect(app.captureCharFrame().split("\n")[0]).toBe(app.captureCharFrame().split("\n")[1])
    title.content = "Short"
    title.rename = { title: "Short", pending: false }
    clock.advance(180)
    await app.renderOnce()
    expect(app.captureCharFrame().split("\n")[0].trim()).toBe("Sh B")
    expect(app.captureCharFrame().split("\n")[2]).toContain("untouched")
    clock.advance(270)
    await app.renderOnce()
    expect(app.captureCharFrame().split("\n")[0].trim()).toBe("Short")
    expect(app.renderer.root.liveCount).toBe(0)
  } finally {
    app.renderer.destroy()
  }
})
