import { afterEach, expect, jest, test } from "bun:test"
import { createRoot } from "solid-js"
import { createStore } from "solid-js/store"
import type { ComposerPersistedState, ComposerSuggestion } from "@/composer/types"
import { createComposerEditor } from "@/composer/editor/interaction"

afterEach(() => {
  jest.useRealTimers()
})

test("moves the @ highlight to the first file once the next search reorders the results", async () => {
  const value = setup({ se: ["src/server.ts", "src/session.ts"], ses: ["src/session.ts", "src/server.ts"] })

  try {
    await value.type("@se")
    expect(activeID(value)).toBe("file:src/server.ts")
    await value.type("@ses", { search: false })
    expect(value.editor.suggestions().map((item) => item.id)).toEqual(["file:src/server.ts", "file:src/session.ts"])
    await value.search()
    expect(activeID(value)).toBe("file:src/session.ts")
  } finally {
    value.dispose()
  }
})

test("Enter does not pick a file left over from the previous @ query while the next search runs", async () => {
  const value = setup({ r: ["r/plan.md"], re: ["re/plan.md"], rez: [] })

  try {
    await value.type("@r")
    await value.type("@re")
    await value.type("@rez", { search: false })
    expect(value.editor.suggestions().map((item) => item.id)).toEqual(["file:re/plan.md"])
    value.editor.onKeyDown(new KeyboardEvent("keydown", { key: "Enter" }))
    expect(value.editor.value()).toBe("@rez")
    expect(value.editor.parts().some((part) => part.type === "file")).toBe(false)
    await value.search()
    expect(value.editor.suggestions()).toEqual([])
  } finally {
    value.dispose()
  }
})

function setup(results: Record<string, string[]>) {
  jest.useFakeTimers()

  return createRoot((dispose) => {
    const store = createStore<ComposerPersistedState>({
      prompt: [{ type: "text", content: "", start: 0, end: 0 }],
      cursor: 0,
      context: { items: [] },
    })

    const editor = createComposerEditor({
      store,
      commands: () => [],
      context: () => [],
      searchContextFiles: (query) => (results[query] ?? []).map(file),
      view: { submit: { stopping: () => false, onSubmit() {}, onStop() {} } },
    })

    const search = async () => {
      jest.runOnlyPendingTimers()

      await flush()
    }

    const type = async (content: string, options?: { search: boolean }) => {
      editor.onInput(content, [{ type: "text", content, start: 0, end: content.length }], content.length)

      await flush()

      if (options?.search !== false) await search()
    }

    return { editor, type, search, dispose }
  })
}

// The search result and the filtered list each settle a few microtasks later.
async function flush() {
  for (const _ of Array.from({ length: 5 })) await Promise.resolve()
}

function activeID(value: ReturnType<typeof setup>) {
  return value.editor.state.popover.type === "closed" ? undefined : value.editor.state.popover.activeID
}

function file(path: string): ComposerSuggestion {
  return {
    id: `file:${path}`,
    kind: "file",
    label: path,
    path,
    mention: { type: "file", path, content: `@${path}`, start: 0, end: 0 },
  }
}
