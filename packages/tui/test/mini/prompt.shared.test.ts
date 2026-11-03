import { describe, expect, test } from "bun:test"
import { measureEditText } from "@opentui/core"
import {
  createPromptHistory,
  isCompactCommand,
  isExitCommand,
  isNewCommand,
  movePromptHistory,
  promptAppend,
  pushPromptHistory,
} from "../../src/mini/prompt.shared"
import type { RunPrompt } from "../../src/mini/types"

function prompt(text: string, parts: RunPrompt["parts"] = []): RunPrompt {
  return { text, parts }
}

describe("run prompt shared", () => {
  test("filters blank prompts and dedupes consecutive history", () => {
    const out = createPromptHistory([prompt("   "), prompt("one"), prompt("one"), prompt("two"), prompt("one")])

    expect(out.items.map((item) => item.text)).toEqual(["one", "two", "one"])
    expect(out.index).toBeNull()
    expect(out.draft).toBe("")
  })

  test("push ignores blanks and dedupes only the latest item", () => {
    const base = createPromptHistory([prompt("one")])

    expect(pushPromptHistory(base, prompt("   ")).items.map((item) => item.text)).toEqual(["one"])
    expect(pushPromptHistory(base, prompt("one")).items.map((item) => item.text)).toEqual(["one"])
    expect(pushPromptHistory(base, prompt("two")).items.map((item) => item.text)).toEqual(["one", "two"])
  })

  test.each(["wcwidth", "unicode"] as const)("moves through history at %s input boundaries", (widthMethod) => {
    const measure = (text: string) => measureEditText(text, { widthMethod })
    const [wide, draft] = ["中文👨‍👩‍👧\n\t", "草稿👨‍👩‍👧\f"]
    const base = createPromptHistory([prompt("one"), prompt(wide)])

    expect(movePromptHistory(base, -1, draft, 1, widthMethod)).toEqual({ state: base, apply: false })

    const up = movePromptHistory(base, -1, draft, 0, widthMethod)
    expect(up).toMatchObject({ apply: true, text: wide, cursor: 0, state: { index: 1, draft } })

    const older = movePromptHistory(up.state, -1, wide, 0, widthMethod)
    expect(older).toMatchObject({ apply: true, text: "one", cursor: 0, state: { index: 0 } })
    expect(movePromptHistory(older.state, 1, "one", 2, widthMethod)).toEqual({ state: older.state, apply: false })

    const newer = movePromptHistory(older.state, 1, "one", measure("one"), widthMethod)
    expect(newer).toMatchObject({ apply: true, text: wide, cursor: measure(wide), state: { index: 1 } })

    const back = movePromptHistory(newer.state, 1, wide, measure(wide), widthMethod)
    expect(back).toMatchObject({ apply: true, text: draft, cursor: measure(draft), state: { index: null } })
  })

  test("recognizes exit commands", () => {
    expect(isExitCommand("/exit")).toBe(true)
    expect(isExitCommand(" /Quit ")).toBe(true)
    expect(isExitCommand("/quit now")).toBe(false)
  })

  test("recognizes the new-session command", () => {
    expect(isNewCommand("/new")).toBe(true)
    expect(isNewCommand(" /NEW ")).toBe(true)
    expect(isNewCommand("/new now")).toBe(false)
  })

  test("recognizes only the compact command", () => {
    expect(isCompactCommand("/compact")).toBe(true)
    expect(isCompactCommand(" /COMPACT ")).toBe(true)
    expect(isCompactCommand("/summarize")).toBe(false)
  })
})

describe("promptAppend", () => {
  test.each(["wcwidth", "unicode"] as const)("appends and shifts part ranges by the %s offset", (widthMethod) => {
    const output = promptAppend(
      prompt("日本👨‍👩‍👧\t", [{ type: "agent", name: "plan", source: { start: 0, end: 4, value: "日本" } }]),
      {
        messageID: "m-1",
        ...prompt("@a.ts /x", [
          { type: "file", url: "file:///a.ts", source: { type: "file", text: { start: 0, end: 5, value: "@a.ts" } } },
          { type: "skill", id: "x", source: { start: 6, end: 8, value: "/x" } },
        ]),
      },
      widthMethod,
    )

    const offset = measureEditText("日本👨‍👩‍👧\t\n\n", { widthMethod })
    expect(output).toEqual({
      text: "日本👨‍👩‍👧\t\n\n@a.ts /x",
      parts: [
        { type: "agent", name: "plan", source: { start: 0, end: 4, value: "日本" } },
        {
          type: "file",
          url: "file:///a.ts",
          source: { type: "file", text: { start: offset, end: offset + 5, value: "@a.ts" } },
        },
        { type: "skill", id: "x", source: { start: offset + 6, end: offset + 8, value: "/x" } },
      ],
    })
    expect(promptAppend(prompt(""), prompt("next"), widthMethod)).toEqual(prompt("next"))
  })
})
