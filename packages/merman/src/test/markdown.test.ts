import { afterAll, afterEach, beforeAll, expect, test } from "bun:test"
import { mkdir } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { CodeRenderable, MarkdownRenderable, RGBA, SyntaxStyle, TreeSitterClient } from "@opentui/core"
import { createTestRenderer } from "@opentui/core/testing"
import { createMermaidMarkdownRenderer } from "../markdown.js"

const syntaxStyle = SyntaxStyle.fromStyles({
  default: { fg: RGBA.fromValues(1, 1, 1, 1) },
})
let treeSitterClient: TreeSitterClient
let renderer: Awaited<ReturnType<typeof createTestRenderer>>["renderer"] | undefined

beforeAll(async () => {
  const dataPath = join(tmpdir(), "merman-markdown-test-data")
  await mkdir(dataPath, { recursive: true })
  treeSitterClient = new TreeSitterClient({ dataPath })
  await treeSitterClient.initialize()
})

afterAll(async () => {
  await treeSitterClient.destroy()
})

afterEach(() => {
  renderer?.destroy()
  renderer = undefined
})

async function renderMarkdown(
  markdown: MarkdownRenderable,
  renderOnce: () => Promise<void>,
  timeoutMs = 2_000,
): Promise<void> {
  const hasPendingHighlights = (): boolean => {
    const children = [...markdown.getChildren()]
    while (children.length > 0) {
      const child = children.pop()!
      if (child instanceof CodeRenderable && child.isHighlighting) return true
      children.push(...child.getChildren())
    }
    return false
  }

  const startedAt = Date.now()
  await renderOnce()
  while (hasPendingHighlights() && Date.now() - startedAt < timeoutMs) {
    await Bun.sleep(10)
    await renderOnce()
  }
  if (hasPendingHighlights()) throw new Error("Timed out waiting for Markdown highlights")
  await renderOnce()
}

test("renders a Mermaid flowchart fence inside MarkdownRenderable", async () => {
  const testRenderer = await createTestRenderer({ width: 80, height: 14 })
  renderer = testRenderer.renderer
  const { renderOnce, captureCharFrame } = testRenderer
  const markdown = new MarkdownRenderable(renderer, {
    id: "markdown-mermaid",
    content: `\`\`\`mermaid
flowchart LR
  A[Start] --> B[Done]
\`\`\``,
    syntaxStyle,
    treeSitterClient,
    renderNode: createMermaidMarkdownRenderer(renderer),
  })

  renderer.root.add(markdown)
  await renderMarkdown(markdown, renderOnce)

  const frame = captureCharFrame()
  expect(frame).toContain("Start")
  expect(frame).toContain("Done")
  expect(frame).not.toContain("flowchart LR")
  expect(markdown.getChildren()[0]?.marginTop).toBe(1)
})

test("recognizes normalized Mermaid fence info strings", async () => {
  const testRenderer = await createTestRenderer({ width: 80, height: 14 })
  renderer = testRenderer.renderer
  const { renderOnce, captureCharFrame } = testRenderer
  const markdown = new MarkdownRenderable(renderer, {
    id: "markdown-normalized-mermaid",
    content: `\`\`\`MERMAID title=checkout
flowchart LR
  A[Start] --> B[Done]
\`\`\``,
    syntaxStyle,
    treeSitterClient,
    renderNode: createMermaidMarkdownRenderer(renderer),
  })

  renderer.root.add(markdown)
  await renderMarkdown(markdown, renderOnce)

  const frame = captureCharFrame()
  expect(frame).toContain("Start")
  expect(frame).not.toContain("flowchart LR")
})

test("keeps surrounding Markdown content visible around a Mermaid diagram", async () => {
  const testRenderer = await createTestRenderer({ width: 80, height: 14 })
  renderer = testRenderer.renderer
  const { renderOnce, captureCharFrame } = testRenderer
  const markdown = new MarkdownRenderable(renderer, {
    id: "markdown-with-mermaid",
    content: `Before

\`\`\`mermaid
flowchart LR
  A[Start] --> B[Done]
\`\`\`

After`,
    syntaxStyle,
    treeSitterClient,
    renderNode: createMermaidMarkdownRenderer(renderer),
  })

  renderer.root.add(markdown)
  await renderMarkdown(markdown, renderOnce)

  const frame = captureCharFrame()
  expect(frame).toContain("Before")
  expect(frame).toContain("Start")
  expect(frame).toContain("Done")
  expect(frame).toContain("After")
})

test("renders an incomplete Mermaid fence as ordinary code", async () => {
  const testRenderer = await createTestRenderer({ width: 80, height: 10 })
  renderer = testRenderer.renderer
  const { renderOnce, captureCharFrame } = testRenderer
  const markdown = new MarkdownRenderable(renderer, {
    id: "markdown-incomplete-mermaid",
    content: `\`\`\`mermaid
flowchart LR
  A -->
\`\`\``,
    syntaxStyle,
    treeSitterClient,
    renderNode: createMermaidMarkdownRenderer(renderer),
  })

  renderer.root.add(markdown)
  await renderMarkdown(markdown, renderOnce)

  expect(captureCharFrame()).toContain("flowchart LR")
})

test("keeps the last valid Mermaid diagram while a fence is streaming", async () => {
  const testRenderer = await createTestRenderer({ width: 80, height: 12 })
  renderer = testRenderer.renderer
  const markdown = new MarkdownRenderable(renderer, {
    id: "markdown-streaming-mermaid",
    content: `\`\`\`mermaid
flowchart LR
  A[Stable] --> B[Previous]
\`\`\``,
    syntaxStyle,
    streaming: true,
    internalBlockMode: "top-level",
    renderNode: createMermaidMarkdownRenderer(renderer),
  })

  renderer.root.add(markdown)
  await renderMarkdown(markdown, testRenderer.renderOnce)
  expect(testRenderer.captureCharFrame()).toContain("Previous")

  markdown.content = `\`\`\`mermaid
flowchart LR
  A[Stable] --> B[Previous]
  B -->
\`\`\``
  await renderMarkdown(markdown, testRenderer.renderOnce)
  expect(testRenderer.captureCharFrame()).toContain("Previous")
  expect(testRenderer.captureCharFrame()).not.toContain("flowchart LR")

  markdown.content = `\`\`\`mermaid
flowchart LR
  A[Stable] --> B[Previous]
  B --> C[Current]
\`\`\``
  await renderMarkdown(markdown, testRenderer.renderOnce)
  expect(testRenderer.captureCharFrame()).toContain("Current")
})

test("renders a Mermaid sequence fence inside MarkdownRenderable", async () => {
  const testRenderer = await createTestRenderer({ width: 80, height: 14 })
  renderer = testRenderer.renderer
  const { renderOnce, captureCharFrame } = testRenderer
  const markdown = new MarkdownRenderable(renderer, {
    id: "markdown-sequence",
    content: `\`\`\`mermaid
sequenceDiagram
  Alice->>Bob: Hello
\`\`\``,
    syntaxStyle,
    treeSitterClient,
    renderNode: createMermaidMarkdownRenderer(renderer),
  })

  renderer.root.add(markdown)
  await renderMarkdown(markdown, renderOnce)

  const frame = captureCharFrame()
  expect(frame).toContain("Alice")
  expect(frame).toContain("Bob")
  expect(frame).not.toContain("sequenceDiagram")
})

test("wraps wide Mermaid diagrams in a horizontal viewport", async () => {
  const testRenderer = await createTestRenderer({ width: 40, height: 14 })
  renderer = testRenderer.renderer
  const markdown = new MarkdownRenderable(renderer, {
    id: "markdown-wide-sequence",
    content: `\`\`\`mermaid
sequenceDiagram
  participant A as Alpha participant
  participant B as Beta participant
  participant C as Gamma participant
  A->>B: first
  B->>C: second
\`\`\``,
    syntaxStyle,
    renderNode: createMermaidMarkdownRenderer(renderer, {
      compact: true,
      colors: { primary: "#ff0000" },
    }),
  })

  renderer.root.add(markdown)
  await renderMarkdown(markdown, testRenderer.renderOnce)

  const diagram = markdown.getChildren()[0] as CodeRenderable
  expect(diagram.scrollWidth).toBeGreaterThan(diagram.width)
  expect(diagram.scrollX).toBe(0)

  await testRenderer.mockMouse.drag(diagram.x + 20, diagram.y + 2, diagram.x + 5, diagram.y + 2)
  await testRenderer.renderOnce()
  expect(diagram.scrollX).toBeGreaterThan(0)
  expect(diagram.hasSelection()).toBe(false)

  diagram.scrollX = 0
  await testRenderer.mockMouse.scroll(diagram.x + 20, diagram.y + 2, "right")
  await testRenderer.renderOnce()
  expect(diagram.scrollX).toBeGreaterThan(0)
})

test("renders a Mermaid state fence inside MarkdownRenderable", async () => {
  const testRenderer = await createTestRenderer({ width: 80, height: 14 })
  renderer = testRenderer.renderer
  const { renderOnce, captureCharFrame } = testRenderer
  const markdown = new MarkdownRenderable(renderer, {
    id: "markdown-state",
    content: `\`\`\`mermaid
stateDiagram-v2
  [*] --> Idle
\`\`\``,
    syntaxStyle,
    treeSitterClient,
    renderNode: createMermaidMarkdownRenderer(renderer),
  })

  renderer.root.add(markdown)
  await renderMarkdown(markdown, renderOnce)

  const frame = captureCharFrame()
  expect(frame).toContain("Idle")
  expect(frame).not.toContain("stateDiagram-v2")
})
