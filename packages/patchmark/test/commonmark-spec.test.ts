import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, test } from "bun:test"
import { tests as examples } from "commonmark-spec"
import { createMarkdownStream, renderBlocksToHtml, type BlockPatch, type MarkdownBlock } from "../src/index"
import { rng } from "./fuzz"

interface SpecExample {
  markdown: string
  html: string
  example: number
  start_line?: number
  end_line?: number
  section: string
}

const gfmExamples: SpecExample[] = JSON.parse(readFileSync(resolve(import.meta.dir, "gfm-spec.json"), "utf8"))

const CORPUS_TRANSCRIPTS = [
  "# Architecture Review\n\nHere is the summary with **bold**, *italic*, `src/stream.ts`, and [CommonMark][cm].\n\n1. First item:\n\n   ```ts\n   export const answer = 42\n   ```\n\n   Follow-up paragraph inside item 1.\n\n2. Second item with a nested blockquote:\n   > Quoted line one\n   lazy continuation line two\n\n| Phase | Cost | Share |\n| :--- | ---: | :---: |\n| Split | 6 us | 5% |\n| Render | 185 us | 10% |\n\n$$\n\\int_0^1 x^2\\,dx = \\frac{1}{3}\n$$\n\n[cm]: https://spec.commonmark.org/\n",
  "<details>\n<summary>Click to expand</summary>\n\n- [x] Completed task\n- [ ] Pending task with ~~old~~ new text and https://opencode.ai.\n\n```mermaid\ngraph TD\n  A --> B\n```\n</details>\n\nSetext Heading\n---\n\nTrailing paragraph with $E = mc^2$ and $5 price.\n",
]

function applyPatches(replica: MarkdownBlock[], patches: ReadonlyArray<BlockPatch>) {
  for (const patch of patches) {
    if (patch.op === "append") replica.push(patch.block)
    else if (patch.op === "replace" || patch.op === "finalize") replica[patch.index] = patch.block
    else if (patch.op === "truncate") replica.length = patch.keepCount
  }
}

function assertStreamingInvariance(md: string, chunks: string[], gfm: boolean, math: boolean, wantHtml?: string) {
  const oneShot = createMarkdownStream({ gfm, math, heal: false, holdPendingMarkers: false, renderHtml: true })
  const wantBlocks = oneShot.update(md, { streaming: false }).blocks
  const expectedHtml = wantHtml ?? renderBlocksToHtml(wantBlocks, { gfm, math })

  const stream = createMarkdownStream({ gfm, math, heal: true, holdPendingMarkers: true, renderHtml: true })
  const replica: MarkdownBlock[] = []
  const settledSnapshot = new Map<number, MarkdownBlock>()

  for (const delta of chunks) {
    const frame = stream.append(delta)
    applyPatches(replica, frame.patches)
    expect(replica.length).toBe(frame.blocks.length)

    for (let k = 0; k < frame.blocks.length; k++) {
      expect(replica[k]).toBe(frame.blocks[k])
      const block = frame.blocks[k]!
      const prev = settledSnapshot.get(block.id)

      if (prev) {
        const refUpdated = frame.patches.some((p) => p.op === "replace" && p.id === block.id)

        if (!refUpdated) {
          expect(block).toBe(prev)
        }
      }

      if (block.status === "settled") {
        settledSnapshot.set(block.id, block)
      }
    }
  }

  const finalFrame = stream.finalize()
  applyPatches(replica, finalFrame.patches)
  expect(replica.length).toBe(finalFrame.blocks.length)

  for (let k = 0; k < finalFrame.blocks.length; k++) {
    expect(replica[k]).toBe(finalFrame.blocks[k])
    expect(finalFrame.blocks[k]!.status).toBe("settled")
  }

  expect(renderBlocksToHtml(finalFrame.blocks, { gfm, math })).toBe(expectedHtml)
}

function tokenChunks(md: string, r: () => number): string[] {
  const chunks: string[] = []
  let pos = 0

  while (pos < md.length) {
    const roll = r()
    const step = roll < 0.2 ? 1 : roll < 0.75 ? 2 + Math.floor(r() * 5) : 7 + Math.floor(r() * 14)
    chunks.push(md.slice(pos, pos + step))
    pos += step
  }

  return chunks
}

describe("CommonMark 0.31.2 + GFM spec compliance", () => {
  test("passes all 652 CommonMark 0.31.2 spec examples (100%)", () => {
    expect(examples.length).toBe(652)
    const failures: Array<{ example: number; section: string; markdown: string; got: string; want: string }> = []

    for (const ex of examples) {
      const md = ex.markdown.replace(/→/g, "\t")
      const want = ex.html.replace(/→/g, "\t")
      const stream = createMarkdownStream({ gfm: false, math: false, heal: false, holdPendingMarkers: false, renderHtml: true })
      const frame = stream.update(md, { streaming: false })
      const got = renderBlocksToHtml(frame.blocks, { gfm: false, math: false })

      if (got !== want) {
        failures.push({ example: ex.example, section: ex.section, markdown: md, got, want })
      }
    }

    expect(failures).toEqual([])
  })

  test("passes all 24 GFM spec examples (tables, task lists, strikethrough, autolinks)", () => {
    expect(gfmExamples.length).toBe(24)
    const failures: Array<{ example: number; section: string; markdown: string; got: string; want: string }> = []

    for (const ex of gfmExamples) {
      const stream = createMarkdownStream({ gfm: true, math: false, heal: false, holdPendingMarkers: false, renderHtml: true })
      const frame = stream.update(ex.markdown, { streaming: false })
      const got = renderBlocksToHtml(frame.blocks, { gfm: true, math: false })

      if (got !== ex.html) {
        failures.push({ example: ex.example, section: ex.section, markdown: ex.markdown, got, want: ex.html })
      }
    }

    expect(failures).toEqual([])
  })

  test("streaming invariance: 1-char, seeded random, and token chunking across all 652 CommonMark + 24 GFM + transcripts", () => {
    const allSpec = [
      ...examples.map((ex) => ({
        ...ex,
        markdown: ex.markdown.replace(/→/g, "\t"),
        html: ex.html.replace(/→/g, "\t"),
        gfm: false,
      })),
      ...gfmExamples.map((ex) => ({ ...ex, gfm: true })),
    ]
    const rand = rng(0x5eed1234)

    for (const ex of allSpec) {
      // 1-char streaming on every single spec example (652 CommonMark + 24 GFM)
      assertStreamingInvariance(ex.markdown, [...ex.markdown], ex.gfm, false, ex.html)

      // Seeded random chunking (1..19 chars)
      const randomChunks: string[] = []
      let pos = 0

      while (pos < ex.markdown.length) {
        const len = 1 + Math.floor(rand() * 19)
        randomChunks.push(ex.markdown.slice(pos, pos + len))
        pos += len
      }

      assertStreamingInvariance(ex.markdown, randomChunks, ex.gfm, false, ex.html)

      // Token chunking
      assertStreamingInvariance(ex.markdown, tokenChunks(ex.markdown, rand), ex.gfm, false, ex.html)
    }

    for (const md of CORPUS_TRANSCRIPTS) {
      assertStreamingInvariance(md, [...md], true, true)
      assertStreamingInvariance(md, tokenChunks(md, rand), true, true)
    }
  })
})
