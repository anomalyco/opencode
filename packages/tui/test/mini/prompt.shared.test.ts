import { describe, expect, test } from "bun:test"
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

  test("moves through history only at input boundaries and restores draft", () => {
    const base = createPromptHistory([prompt("one"), prompt("two")])

    expect(movePromptHistory(base, -1, "draft", 1)).toEqual({
      state: base,
      apply: false,
    })

    const up = movePromptHistory(base, -1, "draft", 0)
    expect(up.apply).toBe(true)
    expect(up.text).toBe("two")
    expect(up.cursor).toBe(0)
    expect(up.state.index).toBe(1)
    expect(up.state.draft).toBe("draft")

    const older = movePromptHistory(up.state, -1, "two", 0)
    expect(older.apply).toBe(true)
    expect(older.text).toBe("one")
    expect(older.cursor).toBe(0)
    expect(older.state.index).toBe(0)

    const newer = movePromptHistory(older.state, 1, "one", 3)
    expect(newer.apply).toBe(true)
    expect(newer.text).toBe("two")
    expect(newer.cursor).toBe(3)
    expect(newer.state.index).toBe(1)

    const draft = movePromptHistory(newer.state, 1, "two", 3)
    expect(draft.apply).toBe(true)
    expect(draft.text).toBe("draft")
    expect(draft.cursor).toBe(5)
    expect(draft.state.index).toBeNull()
  })

  test("uses display-width cursors for history restoration", () => {
    const base = createPromptHistory([prompt("one"), prompt("中文")])

    const latest = movePromptHistory(base, -1, "草稿", 0)
    expect(latest.apply).toBe(true)
    expect(latest.text).toBe("中文")
    expect(latest.cursor).toBe(0)

    const older = movePromptHistory(latest.state, -1, "中文", 0)
    expect(older.apply).toBe(true)
    expect(older.text).toBe("one")
    expect(older.cursor).toBe(0)

    const newer = movePromptHistory(older.state, 1, "one", Bun.stringWidth("one"))
    expect(newer.apply).toBe(true)
    expect(newer.text).toBe("中文")
    expect(newer.cursor).toBe(Bun.stringWidth("中文"))

    const draft = movePromptHistory(newer.state, 1, "中文", Bun.stringWidth("中文"))
    expect(draft.apply).toBe(true)
    expect(draft.text).toBe("草稿")
    expect(draft.cursor).toBe(Bun.stringWidth("草稿"))
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
  test("appends on a new line and shifts part ranges by display width", () => {
    const output = promptAppend(
      prompt("日本", [{ type: "agent", name: "plan", source: { start: 0, end: 4, value: "日本" } }]),
      {
        messageID: "m-1",
        ...prompt("@a.ts /x", [
          { type: "file", url: "file:///a.ts", source: { type: "file", text: { start: 0, end: 5, value: "@a.ts" } } },
          { type: "skill", id: "x", source: { start: 6, end: 8, value: "/x" } },
        ]),
      },
    )

    expect(output).toEqual({
      text: "日本\n@a.ts /x",
      parts: [
        { type: "agent", name: "plan", source: { start: 0, end: 4, value: "日本" } },
        { type: "file", url: "file:///a.ts", source: { type: "file", text: { start: 5, end: 10, value: "@a.ts" } } },
        { type: "skill", id: "x", source: { start: 11, end: 13, value: "/x" } },
      ],
    })
    expect(promptAppend(prompt(""), prompt("next"))).toEqual(prompt("next"))
  })
})
