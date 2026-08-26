import { afterEach, expect, test } from "bun:test"
import { Writable } from "node:stream"
import { DEFAULT_THEME, resolveThemeDocument } from "@opencode-ai/theme/tui"
import {
  CodeRenderable,
  ImageRenderable,
  MarkdownRenderable,
  RGBA,
  ScrollBoxRenderable,
  SyntaxStyle,
  TextAttributes,
  TextRenderable,
  createMarkdownCodeBlockRenderer,
  rgbToHex,
} from "@opentui/core"
import { createTestRenderer } from "@opentui/core/testing"
import { renderLatex } from "opentui-math"
import { createLatexCodeBlockRenderer } from "../src/feature-plugins/system/latex"

const renderers: Awaited<ReturnType<typeof createTestRenderer>>["renderer"][] = []
const syntaxStyle = SyntaxStyle.fromStyles({ default: { fg: "#ffffff" } })

afterEach(() => {
  renderers.splice(0).forEach((renderer) => renderer.destroy())
})

async function setup(content: string, width = 80, graphics?: "kitty" | "sixel") {
  const writes: Buffer[] = []
  // OpenTUI accepts an injected Writable, but its public type requires a full TTY stream.
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
  const stdout = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      writes.push(Buffer.from(chunk))
      callback()
    },
  }) as NodeJS.WriteStream
  const output = await createTestRenderer({
    width,
    height: 24,
    remote: true,
    useThread: false,
    stdout,
    bufferedOutput: "stdout",
  })
  renderers.push(output.renderer)
  if (graphics) {
    await output.renderer.setupTerminal()
    output.renderer.stdin.emit("data", Buffer.from(`\x1b[4;432;${width * 9}t`))
    output.renderer.stdin.emit("data", Buffer.from(graphics === "kitty" ? "\x1b_Gi=31337;OK\x1b\\" : "\x1b[?62;4c"))
  }
  writes.length = 0
  const palette = { text: "#abcdef", subdued: "#667788", background: "#1a1b26" }
  const render = createLatexCodeBlockRenderer(output.renderer, () => palette)
  const markdown = new MarkdownRenderable(output.renderer, {
    content,
    syntaxStyle,
    streaming: true,
    internalBlockMode: "top-level",
    renderNode: createMarkdownCodeBlockRenderer({ latex: render, math: render }),
  })
  output.renderer.root.add(markdown)
  await output.renderOnce()
  return { ...output, markdown, palette, writes }
}

test.each(["latex", "math", "tex", "LATEX title=example"])("renders a %s fence", async (language) => {
  const output = await setup(`\`\`\`${language}\n\\frac{1}{2}\n\`\`\``)
  const formula = output.markdown.getChildren()[0]?.getChildren()[0]
  expect(formula).toBeInstanceOf(TextRenderable)
  if (!(formula instanceof TextRenderable)) throw new Error("Expected a formula")
  expect(formula.height).toBe(3)
  expect(formula.chunks.find((chunk) => chunk.text === "1")?.fg?.equals(RGBA.fromHex("#abcdef"))).toBe(true)
  expect(output.captureCharFrame()).toContain("1")
  expect(output.captureCharFrame()).toContain("2")
  expect(output.captureCharFrame()).not.toContain("\\frac")
})

test.each([
  String.raw`\frac{1}{`,
  String.raw`\unsupported{x}`,
  String.raw`\documentclass{article}
\begin{document}
Hello
\end{document}`,
])("preserves invalid or unsupported math as source: %s", async (source) => {
  const output = await setup(`\`\`\`latex\n${source}\n\`\`\``)
  const block = output.markdown.getChildren()[0]
  expect(block).toBeInstanceOf(CodeRenderable)
  if (!(block instanceof CodeRenderable)) throw new Error("Expected source fallback")
  expect(block.content).toBe(source)
})

test("renders the next valid formula after an incomplete streaming prefix", async () => {
  const output = await setup("```latex\n\\frac{1}{")
  expect(output.markdown.getChildren()[0]).toBeInstanceOf(CodeRenderable)

  output.markdown.content += "2}"
  await output.renderOnce()
  expect(output.markdown.getChildren()[0]?.getChildren()[0]).toBeInstanceOf(TextRenderable)
  expect(output.captureCharFrame()).not.toContain("\\frac")

  output.markdown.content += "\n```"
  output.markdown.streaming = false
  await output.renderOnce()
  expect(output.markdown.getChildren()[0]?.getChildren()[0]).toBeInstanceOf(TextRenderable)
})

test("retains the last valid Unicode formula while the next fraction is incomplete", async () => {
  const output = await setup("```latex\n\\frac{a_1+b_1}{c_1+d_1}")
  const previous = output.captureCharFrame()
  output.markdown.content += "+\\frac{a_"
  await output.renderOnce()
  expect(output.markdown.getChildren()[0]).toBeInstanceOf(ScrollBoxRenderable)
  expect(output.captureCharFrame()).toBe(previous)

  output.markdown.content += "2+b_2}{c_2+d_2}"
  await output.renderOnce()
  expect(output.captureCharFrame()).not.toBe(previous)
  expect(output.captureCharFrame()).not.toContain("\\frac")
})

test.each(["close", "stop"])("discards an incomplete preview when the stream ends: %s", async (end) => {
  const output = await setup("```latex\nx^2")
  output.markdown.content += " + \\frac{1}{"
  await output.renderOnce()
  expect(output.markdown.getChildren()[0]).toBeInstanceOf(ScrollBoxRenderable)

  if (end === "close") output.markdown.content += "\n```"
  if (end === "stop") output.markdown.streaming = false
  await output.renderOnce()
  expect(output.markdown.getChildren()[0]).toBeInstanceOf(CodeRenderable)
})

test("does not reuse another fence's preview or keep a removed fence's preview", async () => {
  const output = await setup("```latex\nx^2\n```\n\n```latex\n\\frac{1}{")
  expect(output.markdown.getChildren()[1]).toBeInstanceOf(CodeRenderable)

  output.markdown.content = ""
  await output.renderOnce()
  output.markdown.content = "```latex\nx^2 + \\frac{1}{"
  await output.renderOnce()
  expect(output.markdown.getChildren()[0]).toBeInstanceOf(CodeRenderable)
})

test("does not leave a stale formula when a stream ends with invalid math", async () => {
  const output = await setup("```latex\nx^2")
  expect(output.markdown.getChildren()[0]?.getChildren()[0]).toBeInstanceOf(TextRenderable)

  output.markdown.content += " + \\unsupported{x}\n```"
  output.markdown.streaming = false
  await output.renderOnce()
  expect(output.markdown.getChildren()[0]).toBeInstanceOf(CodeRenderable)
})

test("keeps a matrix and surrounding Markdown intact in a narrow terminal", async () => {
  const output = await setup("Before\n\n```math\n\\begin{pmatrix}a & b \\\\ c & d\\end{pmatrix}\n```\n\nAfter", 32)
  await output.renderOnce()
  const frame = output.captureCharFrame()
  expect(frame).toContain("Before")
  expect(frame).toContain("a b")
  expect(frame).toContain("c d")
  expect(frame).toContain("After")
  expect(frame).not.toContain("pmatrix")
})

test("leaves ordinary code fences alone", async () => {
  const output = await setup("```typescript\nconst x = 2\n```")
  expect(output.markdown.getChildren()[0]).toBeInstanceOf(CodeRenderable)
})

test("allows wide formulas to scroll horizontally without wrapping", async () => {
  const output = await setup(
    "```latex\n\\text{Start a very long formula with enough content to overflow Finish}\n```",
    24,
  )
  const viewport = output.markdown.getChildren()[0]
  expect(viewport).toBeInstanceOf(ScrollBoxRenderable)
  if (!(viewport instanceof ScrollBoxRenderable)) throw new Error("Expected a horizontal viewport")
  expect(output.captureCharFrame()).toContain("Start")
  expect(output.captureCharFrame()).not.toContain("Finish")
  expect(viewport.height).toBe(1)

  await output.mockMouse.scroll(2, 1, "right")
  await output.renderOnce()
  expect(viewport.scrollLeft).toBeGreaterThan(0)

  viewport.scrollLeft = viewport.scrollWidth
  await output.renderOnce()
  expect(output.captureCharFrame()).toContain("Finish")
  expect(output.captureCharFrame()).not.toContain("Start")
})

test("subdues structure and emphasizes relations using the theme", async () => {
  const output = await setup("```latex\nx=\\frac{1}{2}\n```")
  const formula = output.markdown.getChildren()[0]?.getChildren()[0]
  if (!(formula instanceof TextRenderable)) throw new Error("Expected Unicode math")
  expect(
    formula.chunks.find((chunk) => chunk.text === "\u2500")?.fg?.equals(RGBA.fromHex(output.palette.subdued)),
  ).toBe(true)
  expect(formula.chunks.find((chunk) => chunk.text === "x")?.fg?.equals(RGBA.fromHex(output.palette.text))).toBe(true)
  expect(formula.chunks.find((chunk) => chunk.text === "=")?.attributes).toBe(TextAttributes.BOLD)

  output.palette.text = "#123456"
  output.palette.subdued = "#789abc"
  output.markdown.refreshStyles()
  await output.renderOnce()
  const updated = output.markdown.getChildren()[0]?.getChildren()[0]
  if (!(updated instanceof TextRenderable)) throw new Error("Expected Unicode math")
  expect(updated.chunks.find((chunk) => chunk.text === "x")?.fg?.equals(RGBA.fromHex(output.palette.text))).toBe(true)
  expect(
    updated.chunks.find((chunk) => chunk.text === "\u2500")?.fg?.equals(RGBA.fromHex(output.palette.subdued)),
  ).toBe(true)
})

async function renderedImage(output: Awaited<ReturnType<typeof setup>>, previous?: ImageRenderable) {
  const deadline = Date.now() + 5_000
  while (Date.now() < deadline) {
    const image = output.markdown
      .getChildren()[0]
      ?.getChildren()
      .find(
        (child) =>
          child instanceof ImageRenderable && child.visible && child.image && child.source !== previous?.source,
      )
    if (image instanceof ImageRenderable && image.image && image.visible) {
      await output.renderOnce()
      return image
    }
    await Bun.sleep(10)
    await output.renderOnce()
  }
  throw new Error("Timed out waiting for native math image")
}

test.each(["kitty", "sixel"] as const)("uses real %s image output when supported", async (protocol) => {
  const output = await setup("```latex\nx=\\frac{1}{2}\n```", 80, protocol)
  expect(output.renderer.resolution).toEqual({ width: 720, height: 432 })
  const image = await renderedImage(output)
  expect(image.effectiveProtocol).toBe(protocol)
  expect(image.loadError).toBeNull()
  await output.renderOnce()
  const bytes = Buffer.concat(output.writes).toString()
  expect(bytes).toMatch(protocol === "kitty" ? /\x1b_G[^;]*;[A-Za-z0-9+/=]{20,}/ : /\x1bP[^q]*q/)
  expect(output.markdown.getChildren()[0]?.getChildren()[0].visible).toBe(false)
})

test("retains the last image across incomplete chunks and until its replacement is ready", async () => {
  const output = await setup("```latex\n\\frac{a_1+b_1}{c_1+d_1}", 80, "kitty")
  const first = await renderedImage(output)
  const previousFrame = output.captureCharFrame()
  output.writes.length = 0
  output.markdown.content += "+\\frac{a_"
  await output.renderOnce()
  expect(output.captureCharFrame()).toBe(previousFrame)
  expect(output.markdown.getChildren()[0]).toBeInstanceOf(ScrollBoxRenderable)
  const retained = await renderedImage(output)
  expect(retained === first).toBe(true)
  expect(retained.source).toBe(first.source)
  expect(Buffer.concat(output.writes).toString()).not.toMatch(/\x1b_G[^;]*;[A-Za-z0-9+/=]{20,}/)

  output.markdown.content += "2+b_2}{c_2+d_2}"
  await output.renderOnce()
  const pending = await renderedImage(output)
  expect(pending.source).toBe(first.source)
  const replacement = await renderedImage(output, first)
  expect(replacement.source).not.toBe(first.source)
  expect(replacement.width).toBeGreaterThan(first.width)
  expect(first.isDestroyed).toBe(true)
})

test("releases a retained image when the Markdown view is destroyed", async () => {
  const output = await setup("```latex\nx^2", 80, "kitty")
  const image = await renderedImage(output)
  output.renderer.destroy()
  await Promise.resolve()
  expect(image.isDestroyed).toBe(true)
})

test("regenerates image pixels when the theme changes without editing the formula", async () => {
  const output = await setup("```latex\nx=\\frac{1}{2}\n```", 80, "kitty")
  const dark = resolveThemeDocument(DEFAULT_THEME, "dark")
  const light = resolveThemeDocument(DEFAULT_THEME, "light")
  output.palette.text = rgbToHex(dark.text.default)
  output.palette.background = rgbToHex(dark.background.default)
  output.markdown.refreshStyles()
  await output.renderOnce()
  const first = await renderedImage(output)
  const pixels = first.image!.raw().data
  const darkColor = dark.text.default.toInts()
  expect(
    pixels.some(
      (alpha, index) =>
        index % 4 === 3 &&
        alpha > 200 &&
        pixels[index - 3] === darkColor[0] &&
        pixels[index - 2] === darkColor[1] &&
        pixels[index - 1] === darkColor[2],
    ),
  ).toBe(true)

  output.palette.text = rgbToHex(light.text.default)
  output.palette.background = rgbToHex(light.background.default)
  output.markdown.refreshStyles()
  await output.renderOnce()
  const second = await renderedImage(output)
  expect(first.isDestroyed).toBe(true)
  expect(second).not.toBe(first)
  const updated = second.image!.raw().data
  const lightColor = light.text.default.toInts()
  expect(
    updated.some(
      (alpha, index) =>
        index % 4 === 3 &&
        alpha > 200 &&
        updated[index - 3] === lightColor[0] &&
        updated[index - 2] === lightColor[1] &&
        updated[index - 1] === lightColor[2],
    ),
  ).toBe(true)
})

test("does not add a late image after the math block is removed", async () => {
  const output = await setup("```latex\nx=\\frac{1}{2}\n```", 80, "kitty")
  output.markdown.content = ""
  await Bun.sleep(150)
  await output.renderOnce()
  expect(output.markdown.getChildren()).toHaveLength(0)
  expect(Buffer.concat(output.writes).toString()).not.toMatch(/\x1b_G[^;]*;[A-Za-z0-9+/=]{20,}/)
})

test("matches the surrounding background despite Kitty clearing cells to terminal defaults", async () => {
  const output = await setup("```latex\n\\frac{1}{2}\n```", 80, "kitty")
  const first = await renderedImage(output)
  expect(Array.from(first.image!.raw().data.subarray(0, 4))).toEqual(RGBA.fromHex(output.palette.background).toInts())

  output.palette.background = "#e5e7eb"
  output.markdown.refreshStyles()
  await output.renderOnce()
  const second = await renderedImage(output)
  expect(Array.from(second.image!.raw().data.subarray(0, 4))).toEqual(RGBA.fromHex(output.palette.background).toInts())
})

test("upgrades to images when terminal capabilities arrive after the first render", async () => {
  const output = await setup("```latex\nx=\\frac{1}{2}\n```")
  expect(output.markdown.getChildren()[0]?.getChildren()[0]).toBeInstanceOf(TextRenderable)
  await output.renderer.setupTerminal()
  output.renderer.stdin.emit("data", Buffer.from("\x1b_Gi=31337;OK\x1b\\"))
  await output.renderOnce()
  expect((await renderedImage(output)).effectiveProtocol).toBe("kitty")
})

test("waits until an offscreen formula is visible before rasterizing it", async () => {
  const output = await setup("", 80, "kitty")
  output.renderer.root.remove(output.markdown)
  const viewport = new ScrollBoxRenderable(output.renderer, { width: 80, height: 24 })
  viewport.add(new TextRenderable(output.renderer, { content: "Earlier messages", height: 400, flexShrink: 0 }))
  viewport.add(output.markdown)
  output.renderer.root.add(viewport)
  output.markdown.content = "```latex\nx^2\n```"
  await output.renderOnce()
  expect(output.markdown.screenY).toBeGreaterThan(24)
  await Bun.sleep(150)
  expect(
    output.markdown
      .getChildren()[0]
      ?.getChildren()
      .some((child) => child instanceof ImageRenderable),
  ).toBe(false)

  viewport.scrollTop = viewport.scrollHeight
  await output.renderOnce()
  expect(output.markdown.screenY).toBeLessThan(24)
  expect((await renderedImage(output)).effectiveProtocol).toBe("kitty")
})

test("can force styled Unicode even on an image-capable terminal", async () => {
  const output = await setup("```latex\nx=\\frac{1}{2}\n```", 80, "kitty")
  output.markdown.renderNode = createMarkdownCodeBlockRenderer({
    latex: createLatexCodeBlockRenderer(output.renderer, () => ({ ...output.palette, mode: "cells" })),
  })
  await Bun.sleep(150)
  await output.renderOnce()
  expect(output.markdown.getChildren()[0]?.getChildren()).toHaveLength(1)
  expect(output.markdown.getChildren()[0]?.getChildren()[0]).toBeInstanceOf(TextRenderable)
  expect(Buffer.concat(output.writes).toString()).not.toMatch(/\x1b_G[^;]*;[A-Za-z0-9+/=]{20,}/)
})

test.each([String.raw`\text{${"\u4e2d\u6587"}}=x`, String.raw`\frac{\text{${"\u4e2d\u6587"}}}{abcd}=x`])(
  "preserves wide-character alignment: %s",
  async (source) => {
    const layout = renderLatex(source)
    const output = await setup(`\`\`\`latex\n${source}\n\`\`\``, layout.width)
    const viewport = output.markdown.getChildren()[0]
    if (!(viewport instanceof ScrollBoxRenderable)) throw new Error("Expected math viewport")
    const formula = viewport.getChildren()[0]
    if (!(formula instanceof TextRenderable)) throw new Error("Expected Unicode math")
    expect(
      formula.chunks
        .map((chunk) => chunk.text)
        .join("")
        .split("\n")
        .map((line) => line.trimEnd())
        .join("\n"),
    ).toBe(layout.toString())
    expect(viewport.scrollWidth).toBe(layout.width)
  },
)
