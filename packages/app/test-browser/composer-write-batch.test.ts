import { expect, test } from "bun:test"
import { createComputed, createRoot } from "solid-js"
import { SessionMessage } from "@opencode/schema/session-message"
import { ServerScope } from "@/runtime/server/scope"
import { createComposerState, type ComposerStore } from "@/composer/state"
import { createComposerEditorActions } from "@/composer/editor/actions"
import { flushPersisted } from "@/runtime/persistence/persist"

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

test("composer-write-batch: a burst of edits persists once with prompt, cursor and retry together", async () => {
  const value = setup()
  try {
    await value.state.ready.promise
    value.state.context.add({ type: "file", path: "src/queue.ts", preview: "await queue.flush()" })
    value.state.retry.set({ id: SessionMessage.ID.create(), agent: "build", providerID: "test", modelID: "test" })
    flushPersisted()
    value.writes.length = 0
    value.editor.setPrompt([{ type: "text", content: "keep ordering", start: 0, end: 13 }], 13)
    value.editor.setCursor(12)
    expect(value.writes).toHaveLength(0)
    flushPersisted()
    expect(value.writes).toHaveLength(1)
    expect(value.writes[0]).toMatchObject({
      prompt: [{ type: "text", content: "keep ordering", start: 0, end: 13 }],
      cursor: 12,
      context: { items: [{ path: "src/queue.ts", preview: "await queue.flush()" }] },
    })
    expect(value.writes[0].retry).toBeUndefined()
  } finally {
    value.dispose()
  }
})

test("composer-write-batch: a save with no serialized change writes nothing", async () => {
  const value = setup()
  try {
    await value.state.ready.promise
    value.state.set([{ type: "text", content: "previous", start: 0, end: 8 }], 5)
    value.state.mode.set("shell")
    flushPersisted()
    value.writes.length = 0
    value.editor.setCursor(5)
    value.state.mode.set("shell")
    flushPersisted()
    expect(value.writes).toHaveLength(0)
    value.state.reset()
    flushPersisted()
    expect(value.writes).toHaveLength(1)
    expect(value.writes[0]).toMatchObject({ prompt: [{ content: "" }], cursor: 0, mode: "shell" })
  } finally {
    value.dispose()
  }
})

test("composer-write-batch: state replacement snapshots the value at save time", async () => {
  const value = setup()
  try {
    await value.state.ready.promise
    value.state.set([{ type: "text", content: "previous", start: 0, end: 8 }], 5)
    flushPersisted()
    value.writes.length = 0
    const prompt = [{ type: "text" as const, content: "next", start: 0, end: 4 }]
    value.state.set(prompt)
    prompt[0].content = "changed outside the store"
    expect(value.state.current()[0]).toMatchObject({ content: "next" })
    flushPersisted()
    expect(value.writes).toHaveLength(1)
    expect(value.writes[0].prompt).toEqual([{ type: "text", content: "next", start: 0, end: 4 }])
    expect(value.writes[0].cursor).toBe(5)
  } finally {
    value.dispose()
  }
})

test("composer-write-batch: the last edit in a window wins and attachments are retained", async () => {
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
    flushPersisted()
    value.writes.length = 0
    value.editor.setText("new")
    value.editor.addText(" notes")
    flushPersisted()
    expect(value.writes).toHaveLength(1)
    expect(value.writes[0].cursor).toBe(9)
    expect(value.writes[0].prompt).toEqual([
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
    flushPersisted()
    expect(value.writes).toHaveLength(1)
    expect(value.writes[0].prompt).toEqual([{ type: "text", content: "new", start: 0, end: 3 }])
  } finally {
    value.dispose()
  }
})

test("composer-write-batch: observers see every edit before anything is persisted", async () => {
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
      expect(observed).toEqual([0, 0, 0, 0, 0, 0])
      flushPersisted()
      expect(value.writes).toHaveLength(1)
      dispose()
    })
  } finally {
    value.dispose()
  }
})

test("composer-write-batch: disposing the owner saves pending edits", async () => {
  const value = setup()
  await value.state.ready.promise
  value.editor.setPrompt([{ type: "text", content: "unsaved", start: 0, end: 7 }], 7)
  expect(value.writes).toHaveLength(0)
  value.dispose()
  expect(value.writes).toHaveLength(1)
  expect(value.writes[0].prompt).toEqual([{ type: "text", content: "unsaved", start: 0, end: 7 }])
})
