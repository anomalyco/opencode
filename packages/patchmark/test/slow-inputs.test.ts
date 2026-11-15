import { describe, expect, test } from "bun:test"
import { createMarkdownStream, renderBlocksToHtml } from "../src/index"

describe("slow-input linear-time bounds", () => {
  test("deeply nested brackets and bracket-link chains stay linear (<250ms)", () => {
    const t0 = performance.now()
    const nested = "[".repeat(10_000) + "a" + "]".repeat(10_000)
    const f1 = createMarkdownStream({ renderHtml: true }).update(nested, { streaming: false })
    expect(renderBlocksToHtml(f1.blocks)).toContain("[a]")

    const links = "[".repeat(5_000) + "[a](b)".repeat(5_000)
    const f2 = createMarkdownStream({ renderHtml: true }).update(links, { streaming: false })
    expect(renderBlocksToHtml(f2.blocks)).toContain('<a href="b">a</a>')

    const elapsed = performance.now() - t0
    expect(elapsed).toBeLessThan(250)
  })

  test("long * and _ delimiter runs and distinct unclosed backtick runs stay linear (<250ms)", () => {
    const t0 = performance.now()
    const emph = "*a".repeat(5_000) + " " + "_b".repeat(5_000) + " " + "**c*d".repeat(2_000)
    const f1 = createMarkdownStream({ renderHtml: true }).update(emph, { streaming: false })
    expect(f1.blocks).toHaveLength(1)

    const mismatchedHeal = "*a ".repeat(5_000) + "b_ ".repeat(5_000)
    const fHeal = createMarkdownStream({ renderHtml: false }).update(mismatchedHeal, { streaming: true })
    expect(fHeal.blocks).toHaveLength(1)

    const ticks = Array.from({ length: 500 }, (_, i) => "`".repeat(i + 1) + "a").join(" ")
    const f2 = createMarkdownStream({ renderHtml: true }).update(ticks, { streaming: false })
    expect(f2.blocks).toHaveLength(1)

    const elapsed = performance.now() - t0
    expect(elapsed).toBeLessThan(250)
  })

  test("deeply nested blockquotes and lists stay linear (<200ms)", () => {
    const t0 = performance.now()
    const md = "> ".repeat(200) + "deep quote\n\n" + "- ".repeat(200) + "deep list\n"
    const frame = createMarkdownStream({ renderHtml: true }).update(md, { streaming: false })
    expect(frame.blocks).toHaveLength(2)

    const listStream = createMarkdownStream({ renderHtml: false })

    for (let i = 0; i < 1_000; i++) {
      listStream.append(`- item ${i} with **bold** and \`code\`\n`)
    }

    const done = listStream.finalize()
    expect(done.blocks).toHaveLength(1)

    const elapsed = performance.now() - t0
    expect(elapsed).toBeLessThan(200)
  })

  test("huge GFM table streamed row-by-row stays linear (<250ms for 1,000 rows)", () => {
    const t0 = performance.now()
    const stream = createMarkdownStream({ renderHtml: false })
    stream.append("| Col A | Col B | Col C | Col D |\n|---|---|---|---|\n")

    for (let i = 0; i < 1_000; i++) {
      stream.append(`| cell ${i} | **bold ${i}** | \`code ${i}\` | [link](https://example.com/${i}) |\n`)
    }

    const done = stream.finalize()
    expect(done.blocks).toHaveLength(1)
    expect(done.blocks[0]!.kind.type).toBe("table")

    if (done.blocks[0]!.kind.type === "table") {
      expect(done.blocks[0]!.kind.rows).toHaveLength(1_000)
    }

    const elapsed = performance.now() - t0
    expect(elapsed).toBeLessThan(250)
  })

  test(
    "1 MB reply streamed 1 char at a time bounds scanning to the active line",
    () => {
      const unit =
        "## Section Heading\n\nParagraph with **bold**, *italic*, `code`, and [link](https://example.com).\n\n- item one\n- item two\n\n```ts\nconst x = 1;\n```\n\n"
      const full = unit.repeat(Math.ceil(1_048_576 / unit.length)).slice(0, 1_048_576)
      const stream = createMarkdownStream({ renderHtml: false })
      let scanned = 0

      for (let i = 0; i < full.length; i++) {
        scanned += stream.append(full[i]!).charsScanned
      }

      const done = stream.finalize()
      expect(done.blocks.length).toBeGreaterThan(20_000)
      // Count work rather than machine load; the timeout still catches catastrophic regressions.
      expect(scanned).toBeLessThan(full.length * unit.length)
    },
    15_000,
  )
})
