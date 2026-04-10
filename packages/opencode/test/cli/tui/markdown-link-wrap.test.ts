import { describe, expect, test } from "bun:test"
import { Readable } from "node:stream"
import { detectLinks, getLinkId, StyledText, TextRenderable } from "@opentui/core"
import { createTestRenderer } from "@opentui/core/testing"

function ids(attrs: Uint32Array, cols: number, row: number, len: number) {
  return new Set(Array.from({ length: len }, (_, i) => getLinkId(attrs[row * cols + i])).filter(Boolean))
}

describe("tui markdown link wrap", () => {
  test("keeps one hyperlink id across wrapped visual lines", async () => {
    const url = "file:///tmp/" + "very-long-path/".repeat(4) + "file.txt"
    const chunks = detectLinks(
      [
        {
          __isChunk: true as const,
          text: url,
          attributes: 0,
        },
      ],
      {
        content: url,
        highlights: [[0, url.length, "markup.link.url"]],
      },
    )

    expect(chunks[0]?.link?.url).toBe(url)

    const { renderer, renderOnce, captureCharFrame } = await createTestRenderer({
      width: 20,
      height: 10,
      stdin: new Readable({ read() {} }) as NodeJS.ReadStream,
    })

    try {
      renderer.root.add(
        new TextRenderable(renderer, {
          width: "100%",
          content: new StyledText(chunks),
        }),
      )

      await renderOnce()

      const lines = captureCharFrame()
        .split("\n")
        .map((line) => line.trimEnd())
        .filter(Boolean)

      expect(lines.length).toBeGreaterThan(1)
      expect(lines.join("")).toBe(url)

      const attrs = renderer.currentRenderBuffer.buffers.attributes
      const all = lines.map((line, row) => ids(attrs, renderer.currentRenderBuffer.width, row, line.length))

      expect(all[0]!.size).toBe(1)
      expect(all[1]!.size).toBe(1)
      expect([...all[0]!][0]).toBeGreaterThan(0)

      for (const row of all) {
        expect(row.size).toBe(1)
        expect(row).toEqual(all[0])
      }
    } finally {
      renderer.destroy()
    }
  })
})
