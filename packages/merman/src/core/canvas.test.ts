import { describe, expect, test } from "bun:test"
import stringWidth from "string-width"
import { DiagramCanvas, DiagramCanvasSizeError, type DiagramCanvasCell } from "./canvas.js"

describe("DiagramCanvas", () => {
  test("rejects canvases that exceed the rendering budget", () => {
    expect(() => new DiagramCanvas(2_000, 1_000)).toThrow(DiagramCanvasSizeError)
  })

  test("rejects invalid canvas dimensions", () => {
    for (const [width, height] of [
      [-1, 10],
      [10, -1],
      [1.5, 10],
      [Number.NaN, 10],
      [Number.POSITIVE_INFINITY, 10],
    ]) {
      expect(() => new DiagramCanvas(width, height)).toThrow(DiagramCanvasSizeError)
    }
  })

  test("writes cells and text while clipping out-of-bounds positions", () => {
    const canvas = new DiagramCanvas<"label">(5, 2)

    canvas.setCell(0, 0, "A", "label")
    canvas.setCell(9, 0, "X", "label")
    canvas.setText(2, 1, "hey", "label")

    expect(canvas.toString()).toBe("A\n  hey")
  })

  test("uses measured character widths for text placement", () => {
    const canvas = new DiagramCanvas<"label">(5, 1)

    canvas.setText(0, 0, "a界b", "label")

    expect(canvas.toString()).toBe("a界b")
    expect(stringWidth(canvas.toString())).toBe(4)
  })

  test("keeps custom measurement for ASCII text", () => {
    let measurements = 0
    const canvas = new DiagramCanvas<"label">(5, 1, {
      measure: () => {
        measurements += 1
        return 2
      },
    })

    canvas.setText(0, 0, "ab", "label")

    expect(measurements).toBe(2)
    expect(canvas.getCell(2, 0)?.char).toBe("b")
  })

  test("preserves combined graphemes while placing later text", () => {
    const canvas = new DiagramCanvas<"label">(4, 1)

    canvas.setText(0, 0, "e\u0301x", "label")

    expect(canvas.toString()).toBe("e\u0301x")
    expect(stringWidth(canvas.toString())).toBe(2)
  })

  test("merges cells through the adapter-provided merge function", () => {
    type Style = "line"
    const canvas = new DiagramCanvas<Style>(3, 1, {
      mergeCell: (existing, incoming): DiagramCanvasCell<Style> => ({
        ...incoming,
        char: existing.char === "─" && incoming.char === "│" ? "┼" : incoming.char,
      }),
    })

    canvas.setCell(1, 0, "─", "line")
    canvas.setCell(1, 0, "│", "line")

    expect(canvas.toString()).toBe(" ┼")

    canvas.replaceCell(1, 0, "│", "line")
    expect(canvas.toString()).toBe(" │")
  })

  test("iterates style and metadata runs", () => {
    interface Metadata {
      stateId?: string
    }
    const canvas = new DiagramCanvas<"state", Metadata>(4, 1)
    const runs: string[] = []

    canvas.setText(0, 0, "AB", "state", { stateId: "A" })
    canvas.setText(2, 0, "CD", "state", { stateId: "B" })
    canvas.forEachRun(
      (run) => runs.push(`${run.text}:${run.style}:${run.cell.stateId}`),
      () => runs.push("newline"),
      { key: (cell) => [cell.style, cell.stateId] },
    )

    expect(runs).toEqual(["AB:state:A", "CD:state:B"])
  })

  test("can trim bottom whitespace for renderers with dynamic height", () => {
    const canvas = new DiagramCanvas<"label">(3, 3)
    const runs: string[] = []
    canvas.setText(0, 0, "top", "label")

    expect(canvas.toString()).toBe("top\n\n")
    expect(canvas.toString({ trimBottom: true })).toBe("top")
    expect(canvas.getTextSize()).toEqual({ width: 3, height: 3 })
    expect(canvas.getTextSize({ trimBottom: true })).toEqual({ width: 3, height: 1 })

    canvas.forEachRun(
      (run) => runs.push(run.text),
      () => runs.push("newline"),
      { trimBottom: true },
    )
    expect(runs).toEqual(["top"])
  })

  test("can trim unused leading whitespace reserved by layout", () => {
    const canvas = new DiagramCanvas<"label">(3, 3)
    canvas.setText(0, 2, "end", "label")

    expect(canvas.toString({ trimTop: true })).toBe("end")
    expect(canvas.getTextSize({ trimTop: true })).toEqual({ width: 3, height: 1 })
  })

  test("measures trim-aware text height without measuring row width", () => {
    let measurements = 0
    const canvas = new DiagramCanvas(8, 5, {
      measure: (text) => {
        measurements += 1
        return stringWidth(text)
      },
    })
    canvas.setText(1, 2, "middle")
    measurements = 0

    expect(canvas.getTextHeight({ trimTop: true, trimBottom: true })).toBe(1)
    expect(measurements).toBe(0)
  })

  test("updates tracked row extents when the last visible cell is cleared", () => {
    const canvas = new DiagramCanvas(8, 1)
    canvas.setText(1, 0, "abc")
    canvas.setCell(3, 0, " ")

    expect(canvas.toString()).toBe(" ab")
    expect(canvas.getTextSize()).toEqual({ width: 3, height: 1 })
  })

  test("keeps tracked extents equivalent to scanning after mixed writes", () => {
    const canvas = new DiagramCanvas<"line">(20, 10, {
      mergeCell: (_existing, incoming) => incoming,
    })
    let seed = 42
    const next = (limit: number) => {
      seed = (seed * 1_664_525 + 1_013_904_223) >>> 0
      return seed % limit
    }

    for (let index = 0; index < 200; index++) {
      const x = next(canvas.width)
      const y = next(canvas.height)
      const char = [" ", "x", "─"][next(3)]!
      if (next(2) === 0) canvas.setCell(x, y, char, "line")
      else canvas.replaceCell(x, y, char, "line")
    }

    const scanned = canvas.rows.map((row) => {
      let end = row.length
      while (end > 0 && row[end - 1]?.char === " ") end -= 1
      return row
        .slice(0, end)
        .map((cell) => cell.char)
        .join("")
    })
    const first = scanned.findIndex((line) => line.length > 0)
    const last = scanned.findLastIndex((line) => line.length > 0)

    expect(canvas.toString()).toBe(scanned.join("\n"))
    expect(canvas.getTextHeight({ trimTop: true, trimBottom: true })).toBe(first < 0 ? 0 : last - first + 1)
  })
})
