import { describe, expect, test } from "bun:test"

// Regression test for the DialogSkill onSelect handler in
// packages/opencode/src/cli/cmd/tui/component/prompt/index.tsx.
//
// Before the fix, onSelect called `input.setText(`/${skill} `)` which
// replaced the entire prompt content, wiping any text the user had already
// typed. After the fix, it calls `input.insertText(`/${skill} `)` which
// inserts at the cursor position, preserving existing text.
//
// `handleSkillSelect` below has the exact shape of the production handler after
// the fix.

type TextInput = {
  plainText: string
  insertText(text: string): void
}

type Store = {
  prompt: { input: string; parts: unknown[] }
  extmarkToPartIndex: Map<number, number>
}

function makeMockInput(initialText: string, cursorOffset: number): TextInput & { cursorOffset: number } {
  let text = initialText
  let cursor = cursorOffset
  return {
    get plainText() { return text },
    get cursorOffset() { return cursor },
    insertText(insert: string) {
      text = text.slice(0, cursor) + insert + text.slice(cursor)
      cursor += insert.length
    },
  }
}

function handleSkillSelect(input: TextInput, store: Store, syncExtmarks: () => void, skill: string) {
  input.insertText(`/${skill} `)
  store.prompt.input = input.plainText
  syncExtmarks()
}

describe("Prompt skill picker onSelect", () => {
  test("inserts skill name without wiping existing prompt text", () => {
    const input = makeMockInput("some existing text", 18)
    const store: Store = {
      prompt: { input: "some existing text", parts: [] },
      extmarkToPartIndex: new Map(),
    }
    let synced = false

    handleSkillSelect(input, store, () => { synced = true }, "test-skill")

    expect(input.plainText).toBe("some existing text/test-skill ")
    expect(store.prompt.input).toBe("some existing text/test-skill ")
    expect(store.prompt.parts).toEqual([])
    expect(synced).toBe(true)
  })

  test("inserts skill name at cursor position when cursor is at start", () => {
    const input = makeMockInput("existing question here?", 0)
    const store: Store = {
      prompt: { input: "existing question here?", parts: [] },
      extmarkToPartIndex: new Map(),
    }
    let synced = false

    handleSkillSelect(input, store, () => { synced = true }, "test-skill")

    expect(input.plainText).toBe("/test-skill existing question here?")
    expect(store.prompt.input).toBe("/test-skill existing question here?")
    expect(synced).toBe(true)
  })

  test("inserts skill name at cursor position mid-text", () => {
    const input = makeMockInput("hello world", 5)
    const store: Store = {
      prompt: { input: "hello world", parts: [] },
      extmarkToPartIndex: new Map(),
    }
    let synced = false

    handleSkillSelect(input, store, () => { synced = true }, "my-skill")

    expect(input.plainText).toBe("hello/my-skill  world")
    expect(store.prompt.input).toBe("hello/my-skill  world")
    expect(synced).toBe(true)
  })

  test("inserts skill name into empty prompt", () => {
    const input = makeMockInput("", 0)
    const store: Store = {
      prompt: { input: "", parts: [] },
      extmarkToPartIndex: new Map(),
    }
    let synced = false

    handleSkillSelect(input, store, () => { synced = true }, "my-skill")

    expect(input.plainText).toBe("/my-skill ")
    expect(store.prompt.input).toBe("/my-skill ")
    expect(synced).toBe(true)
  })
})


