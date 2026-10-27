import { describe, expect, test } from "bun:test"
import { createMarkdownStream, renderBlocksToHtml, splitPendingMarker, type MarkdownBlock } from "../src/index"

describe("patchmark streaming parser", () => {
  test("preserves exact object references for settled blocks across streaming deltas", () => {
    const stream = createMarkdownStream({ renderHtml: true })
    const f1 = stream.append("# Heading\n\nFirst paragraph.\n\nSecond ")
    expect(f1.blocks.length).toBe(3)
    expect(f1.blocks[0]!.status).toBe("settled")
    expect(f1.blocks[1]!.status).toBe("settled")
    expect(f1.blocks[2]!.status).toBe("streaming")

    const b0 = f1.blocks[0]!
    const b1 = f1.blocks[1]!

    const f2 = stream.append("paragraph continues with **bold")
    expect(f2.blocks[0]).toBe(b0)
    expect(f2.blocks[1]).toBe(b1)
    expect(f2.patches).toHaveLength(1)
    expect(f2.patches[0]!.op).toBe("replace")

    const f3 = stream.finalize()
    expect(f3.blocks[0]).toBe(b0)
    expect(f3.blocks[1]).toBe(b1)
    expect(f3.blocks[2]!.status).toBe("settled")
    expect(f3.patches).toHaveLength(1)
    expect(f3.patches[0]!.op).toBe("finalize")
  })

  test("holds pending block markers until their first word arrives (zero kind-pop)", () => {
    expect(splitPendingMarker("Done.\n\n-")).toEqual({ visible: "Done.\n\n", held: "-" })
    expect(splitPendingMarker("Done.\n\n##")).toEqual({ visible: "Done.\n\n", held: "##" })
    expect(splitPendingMarker("Steps:\n\n12.")).toEqual({ visible: "Steps:\n\n", held: "12." })
    expect(splitPendingMarker("Done.\n\n---")).toEqual({ visible: "Done.\n\n---", held: "" })

    const source =
      "## What changed\n\nThe transcript grows in place.\n\n- One item.\n- Two items.\n\n1. First\n2. Second\n\n> Quoted\n\nThe end."
    const stream = createMarkdownStream()
    const kindsById = new Map<number, MarkdownBlock["kind"]["type"]>()

    for (let i = 1; i <= source.length; i++) {
      const frame = stream.update(source.slice(0, i), { streaming: i < source.length })
      for (const b of frame.blocks) {
        const prev = kindsById.get(b.id)
        if (prev !== undefined) {
          expect(b.kind.type).toBe(prev)
        }
        kindsById.set(b.id, b.kind.type)
      }
    }
  })

  test("heals incomplete emphasis, code spans, and links on the streaming tail", () => {
    const stream = createMarkdownStream({ renderHtml: true })
    const f1 = stream.update("Hello **world", { streaming: true })
    expect(renderBlocksToHtml(f1.blocks)).toBe("<p>Hello <strong>world</strong></p>\n")

    const f2 = stream.update("See [docs](https://example.com/gu", { streaming: true })
    expect(renderBlocksToHtml(f2.blocks)).toBe("<p>See docs</p>\n")

    const f3 = stream.update("See [docs](https://example.com/guide)", { streaming: true })
    expect(renderBlocksToHtml(f3.blocks)).toContain('href="https://example.com/guide"')
  })

  test("streams open code fences in O(|delta|) and settles when fence closes", () => {
    const stream = createMarkdownStream()
    stream.append("Intro\n\n```ts\nconst a = 1;\n")
    const beforeBlock = stream.getBlocks()[0]!
    expect(beforeBlock.status).toBe("settled")

    const f1 = stream.append("const b = 2;\n")
    expect(f1.patches).toHaveLength(1)
    expect(f1.patches[0]!.op).toBe("replace")
    expect(f1.blocks[1]!.kind).toEqual({
      type: "code",
      language: "ts",
      source: "const a = 1;\nconst b = 2;\n",
      fence: "```",
      complete: false,
    })

    // Close fence split across deltas
    stream.append("`")
    stream.append("`")
    const closed = stream.append("`\n\nAfter")
    expect(closed.blocks[1]!.status).toBe("settled")
    expect(closed.blocks[1]!.kind.type).toBe("code")
    if (closed.blocks[1]!.kind.type === "code") {
      expect(closed.blocks[1]!.kind.complete).toBe(true)
    }
  })

  test("keeps fenced code inside its list item (one list block, never split)", () => {
    const stream = createMarkdownStream({ renderHtml: true })
    const frame = stream.update(
      "1. First item\n   ```ts\n   const x = 1\n   ```\n2. Second item\n   ```ts\n   const y = 2",
      { streaming: true },
    )
    expect(frame.blocks.map((b) => [b.kind.type, b.status])).toEqual([["list", "streaming"]])
    const done = stream.finalize()
    expect(done.blocks).toHaveLength(1)
    expect(done.blocks[0]!.html).toBe(
      '<ol>\n<li>First item\n<pre><code class="language-ts">const x = 1\n</code></pre>\n</li>\n<li>Second item\n<pre><code class="language-ts">const y = 2\n</code></pre>\n</li>\n</ol>\n',
    )
  })

  test("resolves late reference link definitions via targeted patch without full-stream live fallback", () => {
    const stream = createMarkdownStream({ renderHtml: true })
    const f1 = stream.append("Read the [specification][spec].\n\nSecond paragraph.\n\n")
    expect(f1.blocks[0]!.status).toBe("settled")
    expect(f1.blocks[1]!.status).toBe("settled")

    // Now the reference definition arrives at the bottom of the stream
    const f2 = stream.append("[spec]: https://spec.commonmark.org/\n\n")
    expect(f2.patches.some((p) => p.op === "replace" && p.id === f1.blocks[0]!.id)).toBe(true)
    expect(renderBlocksToHtml(f2.blocks)).toContain('href="https://spec.commonmark.org/"')
  })

  test("parses inline and display math while keeping currency ($5, $10) as text", () => {
    const stream = createMarkdownStream()
    const frame = stream.update(
      "Lunch costs $5 and $10, while $A = \\pi r^2$ and \\(e^{i\\pi} + 1 = 0\\).\n\n$$\n\\int_0^1 x^2\\,dx = \\frac{1}{3}\n$$\n",
      { streaming: false },
    )
    expect(frame.blocks).toHaveLength(2)
    expect(frame.blocks[0]!.kind.type).toBe("paragraph")
    if (frame.blocks[0]!.kind.type === "paragraph") {
      const mathNodes = frame.blocks[0]!.kind.inlines.filter((n) => n.type === "math")
      expect(mathNodes).toEqual([
        { type: "math", source: "A = \\pi r^2", delimiter: "dollar", display: false },
        { type: "math", source: "e^{i\\pi} + 1 = 0", delimiter: "paren", display: false },
      ])
    }
    expect(frame.blocks[1]!.kind).toEqual({
      type: "math",
      source: "\\int_0^1 x^2\\,dx = \\frac{1}{3}",
      delimiter: "double-dollar",
      complete: true,
    })
  })

  test("streams GFM pipe tables row-by-row once the separator line arrives", () => {
    const stream = createMarkdownStream()
    const f1 = stream.append("| Col A | Col B |\n")
    expect(f1.blocks[0]!.kind.type).toBe("paragraph")
    expect(f1.blocks[0]!.status).toBe("streaming")

    const f2 = stream.append("|---|---|\n| 1 | 2 |\n")
    expect(f2.blocks).toHaveLength(1)
    expect(f2.blocks[0]!.kind.type).toBe("table")
    if (f2.blocks[0]!.kind.type === "table") {
      expect(f2.blocks[0]!.kind.rows).toHaveLength(1)
    }

    const f3 = stream.append("| 3 | **four** |\n")
    if (f3.blocks[0]!.kind.type === "table") {
      expect(f3.blocks[0]!.kind.rows).toHaveLength(2)
    }
  })

  test("prose after a nested fenced code block inside a list item stays a paragraph (never a code block)", () => {
    const md = "1. Step one:\n\n   ```sh\n   bun test\n   ```\n\n   Follow-up prose in item one.\n"
    const stream = createMarkdownStream({ renderHtml: true })
    const done = stream.update(md, { streaming: false })
    expect(done.blocks).toHaveLength(1)
    expect(done.blocks[0]!.html).toBe(
      '<ol>\n<li>\n<p>Step one:</p>\n<pre><code class="language-sh">bun test\n</code></pre>\n<p>Follow-up prose in item one.</p>\n</li>\n</ol>\n',
    )
  })

  test("partial ** on the streaming tail never heals into **** or flashes as an <hr>", () => {
    const md = "Paragraph one.\n\n**Bold heading:** details here.\n"
    const stream = createMarkdownStream({ renderHtml: true, holdPendingMarkers: false })
    for (let i = 1; i <= md.length; i++) {
      const f = stream.update(md.slice(0, i), { streaming: i < md.length })
      for (const b of f.blocks) {
        expect(b.kind.type).not.toBe("hr")
        expect(b.liveRaw ?? b.raw).not.toContain("****")
      }
      expect(renderBlocksToHtml(f.blocks)).not.toContain("<hr")
    }
  })

  test("setext h1/h2 and lazy blockquote continuations match CommonMark while streaming", () => {
    const md = "Title\n===\n\nSection\n---\n\n> quoted first line\nlazy continuation line\n"
    const stream = createMarkdownStream({ renderHtml: true })
    for (let i = 1; i <= md.length; i++) {
      const f = stream.update(md.slice(0, i), { streaming: i < md.length })
      // Partial `-` or `=` underline on Section must never flash as a bullet list
      for (const b of f.blocks) {
        expect(b.kind.type).not.toBe("list")
      }
    }
    const done = stream.finalize()
    expect(renderBlocksToHtml(done.blocks)).toBe(
      "<h1>Title</h1>\n<h2>Section</h2>\n<blockquote>\n<p>quoted first line\nlazy continuation line</p>\n</blockquote>\n",
    )
  })

  test("groupHtmlBlocks keeps multi-block <details> disclosures in one display block", () => {
    const md = "<details>\n<summary>Summary</summary>\n\nHidden paragraph.\n\n```ts\nconst x = 1\n```\n</details>\n\nAfter.\n"
    const stream = createMarkdownStream({ groupHtmlBlocks: true, renderHtml: true })
    const done = stream.update(md, { streaming: false })
    expect(done.blocks).toHaveLength(2)
    expect(done.blocks[0]!.raw).toContain("<details>")
    expect(done.blocks[0]!.raw).toContain("</details>")
    expect(done.blocks[1]!.raw).toBe("After.\n")
  })

  test("omits reference-only paragraphs before a thematic break and patches ref changes on rebuild", () => {
    const stream = createMarkdownStream({ renderHtml: true })
    const first = stream.update("[x][r]\n\nOther\n\n[r]: /one\n---\n", { streaming: true })
    expect(renderBlocksToHtml(first.blocks)).toBe('<p><a href="/one">x</a></p>\n<p>Other</p>\n<hr />\n')

    const next = stream.update("[x][r]\n\nOther\n\n[r]: /two\n---\n", { streaming: true })
    const replica = [...first.blocks]
    for (const p of next.patches) {
      if (p.op === "append") replica.push(p.block)
      else if (p.op === "replace" || p.op === "finalize") replica[p.index] = p.block
      else if (p.op === "truncate") replica.length = p.keepCount
    }
    expect(replica).toEqual([...next.blocks])
    expect(renderBlocksToHtml(replica)).toBe('<p><a href="/two">x</a></p>\n<p>Other</p>\n<hr />\n')
  })
})
