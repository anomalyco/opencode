import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { TerminalState } from "./state"

const decodeTerminalState = Schema.decodeUnknownSync(TerminalState)

describe("TerminalState", () => {
  test("drops invalid terminals and restores a valid active terminal", () => {
    const decoded = decodeTerminalState({
      active: "missing",
      all: [
        null,
        { id: "one", title: "Terminal 2" },
        { id: "one", title: "duplicate", titleNumber: 9 },
        { id: "two", title: "logs", titleNumber: 4, rows: 24, cols: 80, buffer: "output", cursor: 12, scrollY: 3 },
        { title: "no-id" },
      ],
    })
    expect(decoded).toEqual({
      active: "one",
      all: [
        { id: "one", title: "Terminal 2", titleNumber: 2 },
        { id: "two", title: "logs", titleNumber: 4, rows: 24, cols: 80, buffer: "output", cursor: 12, scrollY: 3 },
      ],
    })
    const active = decodeTerminalState({ ...decoded, active: "two" })
    expect(active.active).toBe("two")
    expect(decodeTerminalState(Schema.encodeSync(TerminalState)(active))).toEqual(active)
  })

  test("defaults missing and malformed fields without dropping usable terminals", () => {
    expect(decodeTerminalState({})).toEqual({ active: undefined, all: [] })
    expect(decodeTerminalState({ active: 2, all: "invalid" })).toEqual({ active: undefined, all: [] })
    expect(decodeTerminalState({ all: [null, {}, { id: "" }, { id: 2 }] })).toEqual({ active: undefined, all: [] })
    expect(
      decodeTerminalState({
        all: [
          {
            id: "one",
            title: "Terminal 3",
            titleNumber: Infinity,
            rows: "24",
            cols: 80,
            buffer: false,
            cursor: NaN,
            scrollY: 0,
          },
          { id: "two", title: null, titleNumber: -1, buffer: "saved", cursor: 0 },
        ],
      }),
    ).toEqual({
      active: "one",
      all: [
        { id: "one", title: "Terminal 3", titleNumber: 3, cols: 80, scrollY: 0 },
        { id: "two", title: "", titleNumber: 0, buffer: "saved", cursor: 0 },
      ],
    })
  })
})
