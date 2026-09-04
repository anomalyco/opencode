import { expect, test } from "bun:test"
import { createComputed, createRoot } from "solid-js"
import { SessionMessage } from "@opencode-ai/schema/session-message"
import { ServerScope } from "@/runtime/server/scope"
import { createComposerState, type ComposerStore } from "@/composer/state"
import { createComposerEditorActions } from "@/composer/editor/actions"

function setup(read: () => string | null | Promise<string | null> = () => null) {
  return createRoot((dispose) => {
    const writes: ComposerStore[] = []
    const state = createComposerState(ServerScope.local, { draftID: "composer-write-batch-test" }, undefined, {
      platform: "desktop",
      os: "windows",
      windowID: "composer-write-batch-test",
      openExternal() {},
      restart: async () => {},
      notify: async () => {},
      storage: () => ({
        getItem: read,
        setItem: (_key, value) => {
          writes.push(JSON.parse(value))
        },
        removeItem() {},
      }),
    })
    return { state, writes, editor: createComposerEditorActions(state.store), dispose }
  })
}

test("composer-write-batch: typing persists prompt, cursor and retry together before returning", async () => {
  const value = setup()
  try {
    await value.state.ready.promise
    value.state.context.add({ type: "file", path: "src/queue.ts", preview: "await queue.flush()" })
    value.state.retry.set({ id: SessionMessage.ID.create(), agent: "build", providerID: "test", modelID: "test" })
    value.writes.length = 0
    value.editor.setPrompt([{ type: "text", content: "keep ordering", start: 0, end: 13 }], 13)
    expect(value.writes).toHaveLength(1)
    expect(value.writes[0]).toMatchObject({
      prompt: [{ type: "text", content: "keep ordering", start: 0, end: 13 }],
      cursor: 13,
      context: { items: [{ path: "src/queue.ts", preview: "await queue.flush()" }] },
    })
    expect(value.writes[0].retry).toBeUndefined()
    value.editor.setCursor(13)
    expect(value.writes).toHaveLength(1)
    value.editor.setCursor(12)
    expect(value.writes.map((write) => write.cursor)).toEqual([13, 12])
    value.editor.setCursor(12)
    expect(value.writes).toHaveLength(2)
  } finally {
    value.dispose()
  }
})

test("composer-write-batch: state replacement preserves an omitted cursor and resets in one write", async () => {
  const value = setup()
  try {
    await value.state.ready.promise
    value.state.set([{ type: "text", content: "previous", start: 0, end: 8 }], 5)
    value.state.mode.set("shell")
    value.state.retry.set({ id: SessionMessage.ID.create(), agent: "build", providerID: "test", modelID: "test" })
    value.writes.length = 0
    const prompt = [{ type: "text" as const, content: "next", start: 0, end: 4 }]
    value.state.set(prompt)
    prompt[0].content = "changed outside the store"
    expect(value.state.current()[0]).toMatchObject({ content: "next" })
    expect(value.writes).toHaveLength(1)
    expect(value.writes[0].cursor).toBe(5)
    expect(value.writes[0].retry).toBeUndefined()
    value.state.reset()
    expect(value.writes).toHaveLength(2)
    expect(value.writes[1]).toMatchObject({ prompt: [{ content: "" }], cursor: 0, mode: "shell" })
    value.state.mode.set("normal")
    value.state.mode.set("normal")
    expect(value.writes).toHaveLength(3)
    expect(value.writes[2].mode).toBe("normal")
  } finally {
    value.dispose()
  }
})

test("composer-write-batch: unchanged mode still clears a retry and context writes remain ordered", async () => {
  const value = setup()
  try {
    await value.state.ready.promise
    value.state.mode.set("normal")
    value.state.retry.set({ id: SessionMessage.ID.create(), agent: "build", providerID: "test", modelID: "test" })
    value.writes.length = 0
    value.editor.setMode("normal")
    expect(value.writes).toHaveLength(1)
    expect(value.writes[0].retry).toBeUndefined()
    value.state.context.add({ type: "file", path: "first.ts" })
    value.state.context.add({ type: "file", path: "second.ts" })
    value.state.context.remove(value.state.context.items()[0].key)
    expect(value.writes.slice(1).map((write) => write.context.items.map((item) => item.path))).toEqual([
      ["first.ts"],
      ["first.ts", "second.ts"],
      ["second.ts"],
    ])
  } finally {
    value.dispose()
  }
})

test("composer-write-batch: text replacement and insertion each persist once and retain attachments", async () => {
  const value = setup()
  try {
    await value.state.ready.promise
    value.state.set(
      [
        { type: "text", content: "old", start: 0, end: 3 },
        {
          type: "image",
          id: "image",
          filename: "diagram.png",
          mime: "image/png",
          blob: { id: "diagram", url: "blob:diagram" },
        },
      ],
      3,
    )
    value.writes.length = 0
    value.editor.setText("new")
    value.editor.addText(" notes")
    expect(value.writes).toHaveLength(2)
    expect(value.writes.map((write) => write.cursor)).toEqual([3, 9])
    expect(value.writes[1].prompt).toEqual([
      { type: "text", content: "new notes", start: 0, end: 9 },
      {
        type: "image",
        id: "image",
        filename: "diagram.png",
        mime: "image/png",
        blob: { id: "diagram", url: "blob:diagram" },
      },
    ])
  } finally {
    value.dispose()
  }
})

test("composer-write-batch: an edit still wins over a pending persisted read", async () => {
  const loading = Promise.withResolvers<string>()
  const value = setup(() => loading.promise)
  try {
    value.editor.setPrompt([{ type: "text", content: "new", start: 0, end: 3 }], 3)
    expect(value.writes).toHaveLength(1)
    loading.resolve(
      JSON.stringify({
        prompt: [{ type: "text", content: "old", start: 0, end: 3 }],
        cursor: 1,
        context: { items: [] },
      }),
    )
    await value.state.ready.promise
    expect(value.state.current()).toEqual([{ type: "text", content: "new", start: 0, end: 3 }])
    expect(value.state.cursor()).toBe(3)
    expect(value.writes).toHaveLength(1)
  } finally {
    value.dispose()
  }
})

test("composer-write-batch: persistence still precedes reactive observers", async () => {
  const value = setup()
  try {
    await value.state.ready.promise
    createRoot((dispose) => {
      const observed: number[] = []
      createComputed(() => {
        value.state.current()
        observed.push(value.writes.length)
      })
      value.editor.setPrompt([{ type: "text", content: "new", start: 0, end: 3 }], 3)
      value.editor.setText("replace")
      value.editor.addText(" and insert")
      value.state.set([{ type: "text", content: "restore", start: 0, end: 7 }], 7)
      value.state.reset()
      expect(observed).toEqual([0, 1, 2, 3, 4, 5])
      dispose()
    })
  } finally {
    value.dispose()
  }
})
