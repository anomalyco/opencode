import { describe, expect, test } from "bun:test"
import { renderMath, splitMathSegments } from "../../src/util/latex"

describe("util.latex", () => {
  describe("splitMathSegments", () => {
    test("returns a single text segment without math", () => {
      expect(splitMathSegments("hello world")).toEqual([{ kind: "text", text: "hello world" }])
      expect(splitMathSegments("costs $5 and $10")).toEqual([{ kind: "text", text: "costs $5 and $10" }])
    })

    test("splits a display math block", () => {
      expect(splitMathSegments("before\n$$x^2$$\nafter")).toEqual([
        { kind: "text", text: "before\n" },
        { kind: "math", tex: "x^2", raw: "$$x^2$$" },
        { kind: "text", text: "\nafter" },
      ])
    })

    test("splits multi-line display math", () => {
      const text = "a\n$$\nx+y\n$$\nb"
      const segs = splitMathSegments(text)
      expect(segs[1]).toEqual({ kind: "math", tex: "\nx+y\n", raw: "$$\nx+y\n$$" })
    })

    test("splits \\[ \\] math", () => {
      const segs = splitMathSegments("\\[e^{i\\pi}+1=0\\]")
      expect(segs).toEqual([{ kind: "math", tex: "e^{i\\pi}+1=0", raw: "\\[e^{i\\pi}+1=0\\]" }])
    })

    test("ignores unclosed delimiters", () => {
      expect(splitMathSegments("result: $$x + y")).toEqual([{ kind: "text", text: "result: $$x + y" }])
      expect(splitMathSegments("\\[unclosed")).toEqual([{ kind: "text", text: "\\[unclosed" }])
    })

    test("ignores math inside fenced code blocks", () => {
      const text = "```\n$$not math$$\n```\n$$real$$"
      const segs = splitMathSegments(text)
      expect(segs[0]).toEqual({ kind: "text", text: "```\n$$not math$$\n```\n" })
      expect(segs[1]).toEqual({ kind: "math", tex: "real", raw: "$$real$$" })
    })

    test("ignores escaped delimiters", () => {
      expect(splitMathSegments("\\$$ not math")).toEqual([{ kind: "text", text: "\\$$ not math" }])
    })
  })

  describe("renderMath", () => {
    test("renders tex to a transparent png", async () => {
      const result = await renderMath("\\frac{1}{2}", { color: "#ffffff", fontPx: 16 })
      expect(result).not.toBeNull()
      expect(result!.width).toBeGreaterThan(0)
      expect(result!.height).toBeGreaterThan(0)
      expect([...result!.png.slice(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47])
    })

    test("returns the same promise for repeated input and does not cache failures", async () => {
      const options = { color: "#ffffff", fontPx: 16 }
      expect(renderMath("x^2", options)).toBe(renderMath("x^2", options))
      // \frac with no arguments is a hard tex error; mathjax throws instead of producing svg
      const failed = renderMath("\\frac", options)
      expect(await failed).toBeNull()
      expect(renderMath("\\frac", options)).not.toBe(failed)
    })
  })
})
