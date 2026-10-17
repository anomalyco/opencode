import { describe, expect, test } from "bun:test"
import { cellText, idAt, idUnder } from "../../src/ui/id-click"

const SES = "ses_ee68a7aceffeiGmNH03eS7PU61"
const MSG = "msg_119742d10001srfC3wz8krD00i"

// A frame as the renderer holds it: one code point per cell, rows padded to the width.
function frame(...rows: string[]) {
  const width = Math.max(...rows.map((row) => row.length))
  const char = new Uint32Array(width * rows.length)
  rows.forEach((row, y) => [...row.padEnd(width)].forEach((ch, x) => (char[y * width + x] = ch.codePointAt(0)!)))
  return { width, height: rows.length, buffers: { char } }
}

const area = (x: number, y: number, width: number, height: number) => ({ x, y, width, height })

describe("ui.id-click", () => {
  test("finds a session or message ID under any of its cells", () => {
    const cells = frame(`see \`${SES}\` and ${MSG}.`)
    const ses = 5
    const msg = `see \`${SES}\` and `.length
    expect(idAt(cells, ses, 0)).toEqual({ kind: "session", value: SES })
    expect(idAt(cells, ses + SES.length - 1, 0)).toEqual({ kind: "session", value: SES })
    expect(idAt(cells, msg + 10, 0)).toEqual({ kind: "message", value: MSG })
    expect(idAt(cells, 1, 0)).toBeUndefined()
    expect(idAt(cells, ses - 1, 0)).toBeUndefined()
  })

  test("ignores words that only look like IDs", () => {
    const cells = frame("ses_short tool_ses_ee68a7aceffeiGmNH03eS7PU61 session_id")
    expect(idAt(cells, 2, 0)).toBeUndefined()
    expect(idAt(cells, 20, 0)).toBeUndefined()
    expect(idAt(cells, 50, 0)).toBeUndefined()
  })

  test("reads only inside the clicked renderable, so a neighbouring column does not join the ID", () => {
    const cells = frame(`${SES}abc`)
    expect(idAt(cells, 3, 0)?.value).toBe(`${SES}abc`)
    expect(idAt(cells, 3, 0, area(0, 0, SES.length, 1))).toEqual({ kind: "session", value: SES })
    expect(idAt(cells, SES.length + 1, 0, area(0, 0, SES.length, 1))).toBeUndefined()
  })

  test("the ID under a click is read inside its target", () => {
    const cells = frame(SES)
    expect(idUnder(cells, { x: 2, y: 0, target: area(0, 0, SES.length, 1) })).toEqual({ kind: "session", value: SES })
    expect(idUnder(cells, { x: 2, y: 0, target: null })).toBeUndefined()
  })

  test("a row reads one character per cell", () => {
    const cells = frame("▣  Build · QA Model")
    expect(cellText(cells, 0, 0, 20)).toBe("▣  Build · QA Model")
    expect(cellText(cells, 0, 3, 8)).toBe("Build")
    expect(cellText(cells, 1, 0, 5)).toBe("")
  })
})
