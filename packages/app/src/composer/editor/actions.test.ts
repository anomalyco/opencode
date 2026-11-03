import { describe, expect, test } from "bun:test"
import { createStore } from "solid-js/store"
import { Skill } from "@opencode/schema/skill"
import type { ComposerPersistedState } from "../types"
import { createComposerEditorActions } from "./actions"

const context = { key: "file:src/index.ts", type: "file" as const, path: "src/index.ts" }

function createPromptStore() {
  return createComposerEditorActions(
    createStore<ComposerPersistedState>({
      prompt: [
        { type: "text", content: "old", start: 0, end: 3 },
        {
          type: "image",
          id: "attachment-1",
          filename: "notes.txt",
          mime: "text/plain",
          blob: { id: "a", url: "blob:a" },
        },
      ],
      cursor: 3,
      model: { providerID: "anthropic", modelID: "claude-sonnet", variant: null },
      context: { items: [context] },
    }),
  )
}

describe("Composer store", () => {
  test("updates prompt text and cursor together while preserving attachments", () => {
    const prompt = createPromptStore()

    prompt.setText("updated")

    expect(prompt.state.prompt).toEqual([
      { type: "text", content: "updated", start: 0, end: 7 },
      {
        type: "image",
        id: "attachment-1",
        filename: "notes.txt",
        mime: "text/plain",
        blob: { id: "a", url: "blob:a" },
      },
    ])
    expect(prompt.state.cursor).toBe(7)
  })

  test("inserts text without flattening structured mentions", () => {
    const [state, setState] = createStore<ComposerPersistedState>({
      prompt: [
        { type: "text", content: "A ", start: 0, end: 2 },
        { type: "file", path: "one", content: "@one", start: 2, end: 6 },
        { type: "text", content: " B", start: 6, end: 8 },
      ],
      cursor: 2,
      context: { items: [] },
    })

    const prompt = createComposerEditorActions([state, setState])

    prompt.addText("X\nY")

    expect(prompt.state.prompt).toEqual([
      { type: "text", content: "A X\nY", start: 0, end: 5 },
      { type: "file", path: "one", content: "@one", start: 5, end: 9 },
      { type: "text", content: " B", start: 9, end: 11 },
    ])
    expect(prompt.state.cursor).toBe(5)
  })

  test("mutates mentions, attachments, and context through editor actions", () => {
    const prompt = createPromptStore()

    prompt.addMention({ type: "file", path: "src/app.ts", content: "@src/app.ts", start: 0, end: 0 })
    prompt.removeAttachment("attachment-1")
    prompt.removeContext(context.key)

    expect(prompt.state.context.items).toEqual([])
    expect(prompt.state.prompt).toEqual([
      { type: "text", content: "old", start: 0, end: 3 },
      { type: "file", path: "src/app.ts", content: "@src/app.ts", start: 3, end: 14 },
      { type: "text", content: " ", start: 14, end: 15 },
    ])
  })

  test("prepends a skill mention to an attachment-only draft without flattening it", () => {
    const prompt = createPromptStore()
    prompt.setPrompt([{ type: "file", path: "one", content: "@one", start: 0, end: 4 }], 4)
    prompt.addMention(
      {
        type: "skill",
        id: Skill.ID.make("show-me"),
        name: Skill.Name.make("Show Me"),
        content: "@show-me",
        start: 0,
        end: 0,
      },
      { start: 0, end: 0 },
    )
    expect(prompt.state.prompt).toMatchObject([
      { type: "skill", id: "show-me", content: "@show-me", start: 0, end: 8 },
      { type: "text", content: " ", start: 8, end: 9 },
      { type: "file", path: "one", content: "@one", start: 9, end: 13 },
    ])
    expect(prompt.state.cursor).toBe(9)
  })

  test("inserts consecutive mentions without a range and replaces typed triggers after an existing mention", () => {
    const prompt = createComposerEditorActions(
      createStore<ComposerPersistedState>({
        prompt: [{ type: "text", content: "", start: 0, end: 0 }],
        context: { items: [] },
      }),
    )

    prompt.addMention({ type: "file", path: "src/a.ts", content: "@src/a.ts", start: 0, end: 0 })
    prompt.addMention({ type: "file", path: "src/b.ts", content: "@src/b.ts", start: 0, end: 0 })

    expect(prompt.state.prompt).toEqual([
      { type: "file", path: "src/a.ts", content: "@src/a.ts", start: 0, end: 9 },
      { type: "text", content: " ", start: 9, end: 10 },
      { type: "file", path: "src/b.ts", content: "@src/b.ts", start: 10, end: 19 },
      { type: "text", content: " ", start: 19, end: 20 },
    ])
    expect(prompt.state.cursor).toBe(20)

    prompt.addText("@src/c")
    prompt.addMention({ type: "file", path: "src/c.ts", content: "@src/c.ts", start: 0, end: 0 })

    expect(prompt.state.prompt).toEqual([
      { type: "file", path: "src/a.ts", content: "@src/a.ts", start: 0, end: 9 },
      { type: "text", content: " ", start: 9, end: 10 },
      { type: "file", path: "src/b.ts", content: "@src/b.ts", start: 10, end: 19 },
      { type: "text", content: " ", start: 19, end: 20 },
      { type: "file", path: "src/c.ts", content: "@src/c.ts", start: 20, end: 29 },
      { type: "text", content: " ", start: 29, end: 30 },
    ])
    expect(prompt.state.cursor).toBe(30)

    prompt.setPrompt([{ type: "file", path: "src/a.ts", content: "@src/a.ts", start: 0, end: 9 }], 9)
    prompt.addMention({ type: "file", path: "src/b.ts", content: "@src/b.ts", start: 0, end: 0 })

    expect(prompt.state.prompt).toEqual([
      { type: "file", path: "src/a.ts", content: "@src/a.ts", start: 0, end: 9 },
      { type: "file", path: "src/b.ts", content: "@src/b.ts", start: 9, end: 18 },
      { type: "text", content: " ", start: 18, end: 19 },
    ])
    expect(prompt.state.cursor).toBe(19)
  })
})
