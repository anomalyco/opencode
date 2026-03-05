import { describe, expect, test } from "bun:test"
import { applyHashlineEdits, hashlineID, hashlineLine, hashlineRef, parseHashlineRef } from "../../src/tool/hashline"

function swapID(ref: string) {
  const [line, id] = ref.split("#")
  const next = id[0] === "Z" ? `P${id[1]}` : `Z${id[1]}`
  return `${line}#${next}`
}

function errorMessage(run: () => void) {
  try {
    run()
    return ""
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
}

describe("tool.hashline", () => {
  test("hash computation is stable and 2-char alphabet encoded", () => {
    const a = hashlineID(1, "  const x = 1")
    const b = hashlineID(1, "constx=1")
    const c = hashlineID(99, "constx=1")
    expect(a).toBe(b)
    expect(a).toBe(c)
    expect(a).toMatch(/^[ZPMQVRWSNKTXJBYH]{2}$/)
  })

  test("low-signal lines mix line index into hash id", () => {
    const a = hashlineID(1, "")
    const b = hashlineID(2, "")
    const c = hashlineID(1, "{}")
    const d = hashlineID(2, "{}")
    expect(a).not.toBe(b)
    expect(c).not.toBe(d)
  })

  test("autocorrect strips copied hashline prefixes when enabled", () => {
    const old = Bun.env.OPENCODE_HL_AUTOCORRECT
    Bun.env.OPENCODE_HL_AUTOCORRECT = "1"
    try {
      const result = applyHashlineEdits({
        lines: ["a"],
        trailing: false,
        edits: [
          {
            type: "set_line",
            line: hashlineRef(1, "a"),
            text: hashlineLine(1, "a"),
          },
        ],
      })
      expect(result.lines).toEqual(["a"])
    } finally {
      if (old === undefined) delete Bun.env.OPENCODE_HL_AUTOCORRECT
      else Bun.env.OPENCODE_HL_AUTOCORRECT = old
    }
  })

  test("default autocorrect does not rewrite non-prefix content", () => {
    const result = applyHashlineEdits({
      lines: ["a"],
      trailing: false,
      edits: [
        {
          type: "set_line",
          line: hashlineRef(1, "a"),
          text: "+a",
        },
      ],
      autocorrect: true,
      aggressiveAutocorrect: false,
    })
    expect(result.lines).toEqual(["+a"])
  })

  test("parses strict LINE#ID references with tolerant extraction", () => {
    const ref = parseHashlineRef(">>> 12#ZP:const value = 1", "line")
    expect(ref.line).toBe(12)
    expect(ref.id).toBe("ZP")
    expect(ref.raw).toBe("12#ZP")

    expect(() => parseHashlineRef("12#ab", "line")).toThrow("LINE#ID")
  })

  test("reports compact mismatch errors with retry anchors", () => {
    const lines = ["alpha", "beta", "gamma"]
    const wrong = swapID(hashlineRef(2, lines[1]))

    const message = errorMessage(() =>
      applyHashlineEdits({
        lines,
        trailing: false,
        edits: [
          {
            type: "set_line",
            line: wrong,
            text: "BETA",
          },
        ],
      }),
    )

    expect(message).toContain("anchor mismatch")
    expect(message).toContain("retry with")
    expect(message).not.toContain(">>>")
    expect(message.length).toBeLessThan(260)
  })

  test("applies batched line edits bottom-up for stable results", () => {
    const lines = ["a", "b", "c", "d"]
    const one = hashlineRef(1, lines[0])
    const two = hashlineRef(2, lines[1])
    const three = hashlineRef(3, lines[2])
    const four = hashlineRef(4, lines[3])

    const result = applyHashlineEdits({
      lines,
      trailing: false,
      edits: [
        {
          type: "replace_lines",
          start_line: two,
          end_line: three,
          text: ["B", "C"],
        },
        {
          type: "insert_after",
          line: one,
          text: "A1",
        },
        {
          type: "set_line",
          line: four,
          text: "D",
        },
      ],
    })

    expect(result.lines).toEqual(["a", "A1", "B", "C", "D"])
  })

  test("orders append and prepend deterministically on empty files", () => {
    const result = applyHashlineEdits({
      lines: [],
      trailing: false,
      edits: [
        {
          type: "append",
          text: "end",
        },
        {
          type: "prepend",
          text: "start",
        },
      ],
    })

    expect(result.lines).toEqual(["start", "end"])
  })

  test("validates ranges, between constraints, and non-empty insert text", () => {
    const lines = ["a", "b", "c"]
    const one = hashlineRef(1, lines[0])
    const two = hashlineRef(2, lines[1])

    expect(() =>
      applyHashlineEdits({
        lines,
        trailing: false,
        edits: [
          {
            type: "replace_lines",
            start_line: two,
            end_line: one,
            text: "x",
          },
        ],
      }),
    ).toThrow("start_line")

    expect(() =>
      applyHashlineEdits({
        lines,
        trailing: false,
        edits: [
          {
            type: "insert_between",
            after_line: two,
            before_line: one,
            text: "x",
          },
        ],
      }),
    ).toThrow("insert_between.after_line")

    expect(() =>
      applyHashlineEdits({
        lines,
        trailing: false,
        edits: [
          {
            type: "append",
            text: "",
          },
        ],
      }),
    ).toThrow("append.text")
  })
})
