import { expect, test } from "bun:test"
import { BoxRenderable, RGBA, TextAttributes, TextRenderable } from "@opentui/core"
import { createTestRenderer, ManualClock } from "@opentui/core/testing"
import { TitleShimmerRenderable } from "../../src/component/title-shimmer"

for (const light of [false, true]) {
  test(`shimmer travels right without changing text or geometry (${light ? "light" : "dark"})`, async () => {
    const clock = new ManualClock()
    const app = await createTestRenderer({ width: 32, height: 2, useThread: false, clock })
    const foreground = RGBA.fromHex(light ? "#111111" : "#eeeeee")
    const background = RGBA.fromHex(light ? "#eeeeee" : "#111111")
    const title = new TitleShimmerRenderable(app.renderer, {
      width: 24,
      height: 1,
      wrapMode: "none",
      content: "abcdefghijklmnopqrstuvwx",
      fg: foreground,
      backdrop: background,
      attributes: TextAttributes.ITALIC,
      rename: { title: "abcdefghijklmnopqrstuvwx", pending: true },
    })
    app.renderer.root.add(title)
    const colors = () =>
      app
        .captureSpans()
        .lines[0].spans.flatMap((span) => Array.from({ length: span.width }, () => span.fg))
        .slice(0, 24)
    const peak = () => {
      const contrast = colors().map(
        (color) =>
          Math.abs(color.r - background.r) + Math.abs(color.g - background.g) + Math.abs(color.b - background.b),
      )
      return contrast.indexOf(Math.max(...contrast))
    }

    try {
      await app.renderOnce()
      const frame = app.captureCharFrame()
      const chunks = title.chunks
      expect(app.renderer.root.liveCount).toBe(1)
      expect(title.canReuseRenderCommandList()).toBe(true)
      clock.advance(300)
      await app.renderOnce()
      const first = peak()
      clock.advance(300)
      await app.renderOnce()
      expect(peak()).toBeGreaterThan(first)
      expect(app.captureCharFrame()).toBe(frame)
      expect(title.chunks).toBe(chunks)
      expect([title.width, title.height]).toEqual([24, 1])
      expect(
        app
          .captureSpans()
          .lines[0].spans.filter((span) => span.text.trim())
          .every((span) => (span.attributes & TextAttributes.ITALIC) !== 0),
      ).toBe(true)

      title.rename = { title: "abcdefghijklmnopqrstuvwx", pending: false }
      await app.renderOnce()
      expect(app.renderer.root.liveCount).toBe(0)
      expect(colors().every((color) => color.equals(foreground))).toBe(true)
      title.enabled = false
      title.rename = { title: "abcdefghijklmnopqrstuvwx", pending: true }
      await app.renderOnce()
      expect(app.renderer.root.liveCount).toBe(0)
      expect(colors().every((color) => color.equals(foreground))).toBe(true)
      title.destroy()
      expect(app.renderer.root.liveCount).toBe(0)
    } finally {
      app.renderer.destroy()
    }
  })
}

test("native glyphs, ancestor clipping, and shorter replacement survive shading", async () => {
  const clock = new ManualClock()
  const app = await createTestRenderer({ width: 32, height: 3, useThread: false, clock })
  const content = "A\u65e5B \u{1f680} C cafe\u0301"
  const title = new TitleShimmerRenderable(app.renderer, {
    width: 24,
    height: 1,
    wrapMode: "none",
    content,
    fg: "#eeeeee",
    backdrop: RGBA.fromHex("#111111"),
    rename: { title: content, pending: true },
  })
  const plain = new TextRenderable(app.renderer, { width: 24, height: 1, content, fg: "#eeeeee", wrapMode: "none" })
  const shadedBox = new BoxRenderable(app.renderer, { width: 24, height: 1, marginLeft: 2, overflow: "hidden" })
  const plainBox = new BoxRenderable(app.renderer, { width: 24, height: 1, marginLeft: 2, overflow: "hidden" })
  shadedBox.add(title)
  plainBox.add(plain)
  app.renderer.root.add(shadedBox)
  app.renderer.root.add(plainBox)
  app.renderer.root.add(new TextRenderable(app.renderer, { content: "untouched", fg: "#eeeeee" }))

  try {
    await app.renderOnce()
    clock.advance(800)
    await app.renderOnce()
    const rows = app.captureCharFrame().split("\n")
    expect(rows[0]).toBe(rows[1])
    expect(rows[0]).toContain(content)
    const colors = app
      .captureSpans()
      .lines[0].spans.flatMap((span) => Array.from({ length: span.width }, () => span.fg.toInts()))
    expect(colors[3]).toEqual(colors[4])
    expect(colors[7]).toEqual(colors[8])

    for (const width of [8, 6, 3]) {
      for (const offset of [0, -2]) {
        shadedBox.width = width
        plainBox.width = width
        title.translateX = offset
        plain.translateX = offset
        clock.advance(200)
        await app.renderOnce()
        const clipped = app.captureCharFrame().split("\n")
        expect(clipped[0]).toBe(clipped[1])
        expect(clipped[2]).toContain("untouched")
      }
    }
    expect(
      app
        .captureSpans()
        .lines[2].spans.find((span) => span.text.includes("untouched"))
        ?.fg.toInts(),
    ).toEqual(RGBA.fromHex("#eeeeee").toInts())

    title.content = "Short"
    plain.content = "Short"
    title.rename = { title: "Short", pending: false }
    await app.renderOnce()
    expect(app.captureCharFrame().split("\n")[0]).toBe(app.captureCharFrame().split("\n")[1])
    expect(app.captureCharFrame()).not.toContain("cafe")
    expect(app.renderer.root.liveCount).toBe(1)
    clock.advance(450)
    await app.renderOnce()
    expect(app.renderer.root.liveCount).toBe(0)
  } finally {
    app.renderer.destroy()
  }
})

test.each([false, true])("arrival wipes right, settles, and never delays text (%s)", async (light) => {
  const clock = new ManualClock()
  const app = await createTestRenderer({ width: 32, height: 2, useThread: false, clock })
  const foreground = RGBA.fromHex(light ? "#111111" : "#eeeeee")
  const background = RGBA.fromHex(light ? "#eeeeee" : "#111111")
  const title = new TitleShimmerRenderable(app.renderer, {
    width: 24,
    height: 1,
    content: "Old title",
    fg: foreground,
    backdrop: background,
    rename: { title: "Old title", pending: true },
  })
  app.renderer.root.add(title)
  const contrast = () =>
    app
      .captureSpans()
      .lines[0].spans.flatMap((span) => Array.from({ length: span.width }, () => Math.abs(span.fg.r - background.r)))
      .slice(0, 24)

  try {
    await app.renderOnce()
    title.content = "abcdefghijklmnopqrstuvwx"
    title.rename = { title: "abcdefghijklmnopqrstuvwx", pending: true }
    await app.renderOnce()
    const chunks = title.chunks
    expect(app.captureCharFrame()).toContain("abcdefghijklmnopqrstuvwx")
    expect(app.captureCharFrame()).not.toContain("Old title")
    expect(app.renderer.root.liveCount).toBe(1)
    title.rename = { title: "abcdefghijklmnopqrstuvwx", pending: false }
    clock.advance(225)
    await app.renderOnce()
    const halfway = contrast()
    expect(halfway[0]).toBeGreaterThan(halfway[23])
    expect(halfway[23]).toBeGreaterThan(0)
    expect(title.chunks).toBe(chunks)
    clock.advance(225)
    await app.renderOnce()
    expect(contrast().every((value) => Math.abs(value - Math.abs(foreground.r - background.r)) < 0.01)).toBe(true)
    expect(app.renderer.root.liveCount).toBe(0)
    expect([title.width, title.height]).toEqual([24, 1])

    title.content = "Manual title"
    title.rename = { title: "Manual title", pending: false }
    await app.renderOnce()
    expect(app.captureCharFrame()).toContain("Manual title")
    expect(app.renderer.root.liveCount).toBe(0)

    title.rename = { title: "Manual title", pending: true }
    title.content = "Next title"
    title.rename = { title: "Next title", pending: false }
    await app.renderOnce()
    expect(app.renderer.root.liveCount).toBe(1)
    title.enabled = false
    await app.renderOnce()
    expect(app.renderer.root.liveCount).toBe(0)
    title.enabled = true
    await app.renderOnce()
    expect(app.renderer.root.liveCount).toBe(0)
  } finally {
    app.renderer.destroy()
  }
})

test("wrapped sidebar titles retain native layout and styles during shimmer and arrival", async () => {
  const clock = new ManualClock()
  const app = await createTestRenderer({ width: 24, height: 10, useThread: false, clock })
  const content = "Review a long title with multiple wrapped lines"
  const title = new TitleShimmerRenderable(app.renderer, {
    width: 16,
    content,
    fg: "#eeeeee",
    attributes: TextAttributes.BOLD,
    backdrop: RGBA.fromHex("#111111"),
    rename: { title: content, pending: true },
  })
  const plain = new TextRenderable(app.renderer, { width: 16, content, fg: "#eeeeee", attributes: TextAttributes.BOLD })
  app.renderer.root.add(title)
  app.renderer.root.add(plain)
  const rows = () => app.captureCharFrame().split("\n")

  try {
    await app.renderOnce()
    clock.advance(300)
    await app.renderOnce()
    expect(title.height).toBeGreaterThan(1)
    expect(title.height).toBe(plain.height)
    expect(rows().slice(0, title.height)).toEqual(rows().slice(title.height, title.height + plain.height))
    expect(
      app
        .captureSpans()
        .lines.slice(0, title.height)
        .every((line) =>
          line.spans.filter((span) => span.text.trim()).every((span) => (span.attributes & TextAttributes.BOLD) !== 0),
        ),
    ).toBe(true)
    title.content = "Short"
    plain.content = "Short"
    title.rename = { title: "Short", pending: false }
    await app.renderOnce()
    expect(title.height).toBe(1)
    expect(rows()[0]).toBe(rows()[1])
    clock.advance(450)
    await app.renderOnce()
    expect(app.renderer.root.liveCount).toBe(0)
  } finally {
    app.renderer.destroy()
  }
})
