import { describe, expect, test } from "bun:test"
import { at, mention, pair } from "./dialog-prompt-editor-input"

describe("dialog prompt editor input", () => {
  test("wraps selection with bracket pairs", () => {
    expect(
      pair({
        text: "abcd",
        start: 1,
        end: 3,
        key: "(",
      }),
    ).toEqual({
      text: "a(bc)d",
      start: 2,
      end: 4,
    })
  })

  test("skips over symmetric closer", () => {
    expect(
      pair({
        text: '""',
        start: 1,
        end: 1,
        key: '"',
      }),
    ).toEqual({
      text: '""',
      start: 2,
      end: 2,
    })
  })

  test("deletes an empty pair with backspace", () => {
    expect(
      pair({
        text: "()",
        start: 1,
        end: 1,
        key: "Backspace",
      }),
    ).toEqual({
      text: "",
      start: 0,
      end: 0,
    })
  })

  test("finds active at query", () => {
    expect(at("read @src/compo", 15)).toEqual({
      start: 5,
      end: 15,
      query: "src/compo",
    })
  })

  test("replaces at query with mention and trailing space", () => {
    expect(mention("read @src/compo now", 5, 15, "src/components/prompt.tsx")).toEqual({
      text: "read @src/components/prompt.tsx now",
      start: 31,
      end: 31,
    })
  })
})
