import { afterEach, expect, test } from "bun:test"
import {
  CodeRenderable,
  MarkdownRenderable,
  RGBA,
  ScrollBoxRenderable,
  SyntaxStyle,
  TextAttributes,
  TextRenderable,
  createMarkdownCodeBlockRenderer,
} from "@opentui/core"
import { createTestRenderer } from "@opentui/core/testing"
import { renderLatex } from "./render"
import { createLatexCodeBlockRenderer } from "./markdown"

const renderers: Awaited<ReturnType<typeof createTestRenderer>>["renderer"][] = []
const syntaxStyle = SyntaxStyle.fromStyles({ default: { fg: "#ffffff" } })

afterEach(() => {
  renderers.splice(0).forEach((renderer) => renderer.destroy())
})

async function setup(content: string, width = 80) {
  const output = await createTestRenderer({
    width,
    height: 24,
    remote: true,
    useThread: false,
  })
  renderers.push(output.renderer)
  const palette = { text: "#abcdef", subdued: "#667788" }
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
  return { ...output, markdown, palette }
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

test.each([32, 120])("renders a boxed cube root after an ordinary cube-root fence at width %s", async (width) => {
  const output = await setup(
    "```latex\n" +
      String.raw`\sqrt[3]{3}\cdot\sqrt[3]{3}=\sqrt[3]{9}` +
      "\n```\n\n```latex\n" +
      String.raw`\sqrt[3]{3}\cdot\sqrt[3]{\boxed{?}}
=
\sqrt[3]{27}
=
3` +
      "\n```",
    width,
  )
  expect(output.markdown.getChildren().map((child) => child.constructor.name)).toEqual([
    "ScrollBoxRenderable",
    "ScrollBoxRenderable",
  ])
  expect(output.captureCharFrame()).not.toContain("\\")
  expect(output.captureCharFrame()).toContain("?")
  expect(output.captureCharFrame()).toContain("= 3")
  expect(output.captureCharFrame()).toContain("\u250c\u2500\u2500\u2500\u2510")
})

test.each([
  String.raw`\sqrt[3]{3}\cdot\sqrt[3]{\boxed{?}}=\sqrt[3]{27}=3`,
  String.raw`\sqrt [3] {3} \cdot
  \sqrt [3] { \boxed
  { ? } } = \sqrt [3] {27} = 3`,
])("ignores harmless whitespace around boxed roots: %s", async (source) => {
  const output = await setup(`\`\`\`latex\n${source}\n\`\`\``)
  expect(output.markdown.getChildren()[0]?.constructor.name).toBe("ScrollBoxRenderable")
  expect(output.captureCharFrame()).not.toContain("\\")
  expect(output.captureCharFrame()).toContain("?")
  expect(output.captureCharFrame()).toContain("= 3")
})

test.each([
  String.raw`\unsupported{x}`,
  String.raw`\cancel{\frac{a}{b}}`,
  String.raw`\unknown*[label]{a}{b}`,
  String.raw`\mystery`,
  String.raw`\constructor{x}`,
])("degrades unknown commands locally without losing their source: %s", async (source) => {
  const output = await setup(`\`\`\`latex\n\\sqrt[3]{${source}}=\\frac{1}{2}\n\`\`\``)
  expect(output.markdown.getChildren()[0]?.constructor.name).toBe("ScrollBoxRenderable")
  expect(output.captureCharFrame()).toContain(source)
  expect(output.captureCharFrame()).toContain("3\u256d")
  expect(output.captureCharFrame()).toContain("\u2570\u256f")
  expect(output.captureCharFrame()).toContain("\u2500\u2500\u2500")
  expect(output.captureCharFrame()).not.toContain("\\sqrt")
  expect(output.captureCharFrame().match(/\\frac/g) ?? []).toHaveLength(source.includes("\\frac") ? 1 : 0)
})

test("preserves line breaks and comments inside opaque commands", async () => {
  const output = await setup("```latex\n\\sqrt{\\unknown{a % comment\n  b}}=1\n```")
  expect(output.markdown.getChildren()[0]?.constructor.name).toBe("ScrollBoxRenderable")
  const frame = output.captureCharFrame()
  expect(frame).toContain("\\unknown{a % comment")
  expect(frame).toContain("  b}")
  expect(frame).not.toContain("\\sqrt")
  expect(frame.indexOf("  b}")).toBeGreaterThan(frame.indexOf("% comment"))
})

test.each([
  String.raw`\frac{1}{`,
  String.raw`\boxed{?`,
  String.raw`\boxed}`,
  String.raw`\unsupported{x`,
  String.raw`\unsupported[option`,
  "x + \\",
  String.raw`\cfrac[x]{1}{2}`,
  String.raw`\left\unknown x\right)`,
  String.raw`\begin{array}{p{2cm}}x\end{array}`,
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

test("falls back to source when a literal layout exceeds the cell budget", async () => {
  const source = "\\unknown{" + "x".repeat(2000) + "\nx".repeat(500) + "}"
  const output = await setup(`\`\`\`latex\n${source}\n\`\`\``)
  const block = output.markdown.getChildren()[0]
  expect(block?.constructor.name).toBe("CodeRenderable")
  if (!(block instanceof CodeRenderable)) throw new Error("Expected source fallback")
  expect(block.content).toBe(source)
})

test.each([
  String.raw`\sqrt[\frac{1}{2}]{x}`,
  String.raw`\left\|v\right\|`,
  String.raw`\left(A\rightarrow B\right)`,
  String.raw`\begin{aligned}a&=b+c\\&=d\end{aligned}`,
  String.raw`\displaylines{x=1\\y=2}`,
  String.raw`\cfrac[l]{1}{12345}`,
  String.raw`\underbrace{a+b+c}_{n}`,
  String.raw`\begin{array}{l|r}a&wide\\long&b\end{array}`,
])("renders structured math through the Markdown adapter: %s", async (source) => {
  const output = await setup(`\`\`\`latex\n${source}\n\`\`\``)
  expect(output.markdown.getChildren()[0]).toBeInstanceOf(ScrollBoxRenderable)
  expect(output.markdown.getChildren()[0]?.getChildren()[0]).toBeInstanceOf(TextRenderable)
  expect(output.captureCharFrame()).not.toContain("\\")
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

test("renders the final formula when the last text update is applied before completion", async () => {
  const output = await setup("```latex\n\\frac{1}{")
  output.markdown.content += "2}\n```"
  output.markdown.streaming = false
  await output.renderOnce()
  expect(output.markdown.getChildren().filter((child) => child instanceof ScrollBoxRenderable).length).toBe(1)
  expect(output.captureCharFrame()).not.toContain("\\frac")
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

test("renders locally preserved commands instead of a stale streaming preview", async () => {
  const output = await setup("```latex\nx^2")
  expect(output.markdown.getChildren()[0]?.getChildren()[0]).toBeInstanceOf(TextRenderable)
  const previous = output.captureCharFrame()

  output.markdown.content += " + \\unsupported{"
  await output.renderOnce()
  expect(output.captureCharFrame()).toBe(previous)

  output.markdown.content += "x}\n```"
  output.markdown.streaming = false
  await output.renderOnce()
  expect(output.markdown.getChildren()[0]?.constructor.name).toBe("ScrollBoxRenderable")
  expect(output.captureCharFrame()).toContain("x\u00b2 + \\unsupported{x}")
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
  const output = await setup("```latex\nx=\\sqrt{\\frac{1}{2}}\n```")
  const formula = output.markdown.getChildren()[0]?.getChildren()[0]
  if (!(formula instanceof TextRenderable)) throw new Error("Expected Unicode math")
  for (const mark of ["\u2500", "\u2502", "\u256d", "\u256f", "\u2570"]) {
    expect(formula.chunks.find((chunk) => chunk.text === mark)?.fg?.equals(RGBA.fromHex(output.palette.subdued))).toBe(
      true,
    )
  }
  expect(formula.chunks.find((chunk) => chunk.text === "x")?.fg?.equals(RGBA.fromHex(output.palette.text))).toBe(true)
  expect(formula.chunks.find((chunk) => chunk.text === "=")?.attributes).toBe(TextAttributes.BOLD)

  output.palette.text = "#123456"
  output.palette.subdued = "#789abc"
  output.markdown.refreshStyles()
  await output.renderOnce()
  const updated = output.markdown.getChildren()[0]?.getChildren()[0]
  if (!(updated instanceof TextRenderable)) throw new Error("Expected Unicode math")
  expect(updated.chunks.find((chunk) => chunk.text === "x")?.fg?.equals(RGBA.fromHex(output.palette.text))).toBe(true)
  for (const mark of ["\u2500", "\u2502", "\u256d", "\u256f", "\u2570"]) {
    expect(updated.chunks.find((chunk) => chunk.text === mark)?.fg?.equals(RGBA.fromHex(output.palette.subdued))).toBe(
      true,
    )
  }
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
