import { describe, expect, test } from "bun:test"
import type { AsyncStorage } from "@solid-primitives/storage"
import { createEffect, createRoot } from "solid-js"
import type { Platform } from "@/context/platform"
import { createPromptReady, createPromptSession } from "@/context/prompt-state"
import { ServerScope } from "@/utils/server-scope"
import { createDraftStore } from "@/utils/draft-store"

let read: ((value: string | null) => void) | undefined

const storage: AsyncStorage = {
  getItem: () => new Promise((resolve) => (read = resolve)),
  setItem: async () => undefined,
  removeItem: async () => undefined,
  clear: async () => undefined,
  key: async () => null,
  getLength: async () => 0,
  length: Promise.resolve(0),
}

const platform: Platform = {
  platform: "web",
  openExternal: () => undefined,
  restart: async () => undefined,
  notify: async () => undefined,
  draftStore: {
    ...storage,
    putBlob: async () => {
      throw new Error("putBlob is not used by this test")
    },
    flush: async () => undefined,
  },
}

describe("prompt persistence", () => {
  test("waits for an async draft to hydrate before reporting ready", async () => {
    await new Promise<void>((resolve, reject) => {
      createRoot((dispose) => {
        const session = createPromptSession(ServerScope.local, { draftID: "draft-async" }, undefined, platform)
        const ready = createPromptReady(() => session)

        expect(ready()).toBe(false)
        expect(session.current()[0]).toMatchObject({ type: "text", content: "" })

        read?.(
          JSON.stringify({
            prompt: [{ type: "text", content: "persisted draft", start: 0, end: 15 }],
            cursor: 15,
            context: { items: [] },
          }),
        )

        createEffect(() => {
          if (!ready()) return
          try {
            expect(session.current()[0]).toMatchObject({ type: "text", content: "persisted draft" })
            dispose()
            resolve()
          } catch (error) {
            dispose()
            reject(error)
          }
        })
      })
    })
  })
})

test("moves legacy image data URLs into blobs and hydrates object URLs", async () => {
  const documents = new Map<string, string>()
  const blobs = new Map<string, Blob>()
  const store = createDraftStore({
    get: async (key) => documents.get(key) ?? null,
    set: async (key, value) => void documents.set(key, value),
    remove: async (key) => void documents.delete(key),
    putBlob: async (blob) => {
      const id = String(blob.size)
      blobs.set(id, blob)
      return id
    },
    getBlob: async (id) => blobs.get(id) ?? null,
  })

  await store.setItem("prompt", JSON.stringify({ prompt: [{ type: "image", dataUrl: "data:image/png;base64,YQ==" }] }))
  await store.flush()
  expect(documents.get("prompt")).not.toContain("dataUrl")
  const value = JSON.parse((await store.getItem("prompt"))!)
  expect(value.prompt[0].blob.id).toBe("1")
  expect(value.prompt[0].blob.url).toStartWith("blob:")
})

test("does not let delayed blob migration overwrite a newer draft", async () => {
  const documents = new Map<string, string>()
  const migration = Promise.withResolvers<void>()
  const store = createDraftStore({
    get: async () => null,
    set: async (key, value) => void documents.set(key, value),
    remove: async () => undefined,
    putBlob: async () => {
      await migration.promise
      return "blob"
    },
    getBlob: async () => null,
  })
  await store.setItem("prompt", JSON.stringify({ prompt: [{ type: "image", dataUrl: "data:image/png;base64,YQ==" }] }))
  const older = store.flush()
  await Bun.sleep(0)
  await store.setItem("prompt", JSON.stringify({ prompt: [{ type: "text", content: "latest" }] }))
  await store.flush()
  migration.resolve()
  await older

  expect(documents.get("prompt")).toContain("latest")
})

test("coalesces a burst of edits into a single encoded write", async () => {
  const writes: string[] = []
  const store = createDraftStore({
    get: async () => null,
    set: async (_key, value) => void writes.push(value),
    remove: async () => undefined,
    putBlob: async () => "blob",
    getBlob: async () => null,
  })

  for (let index = 0; index < 50; index += 1) {
    await store.setItem("prompt", JSON.stringify({ prompt: [{ type: "text", content: "x".repeat(index) }] }))
  }
  expect(writes).toEqual([])

  await store.flush()

  expect(writes.length).toBe(1)
  expect(JSON.parse(writes[0] ?? "{}").prompt[0].content).toBe("x".repeat(49))
})

test("serves a queued draft to a reader that has not been flushed yet", async () => {
  const documents = new Map<string, string>()
  const store = createDraftStore({
    get: async (key) => documents.get(key) ?? null,
    set: async (key, value) => void documents.set(key, value),
    remove: async (key) => void documents.delete(key),
    putBlob: async () => "blob",
    getBlob: async () => null,
  })

  await store.setItem("prompt", JSON.stringify({ prompt: [{ type: "text", content: "queued" }] }))

  expect(documents.has("prompt")).toBe(false)
  expect(JSON.parse((await store.getItem("prompt")) ?? "{}").prompt[0].content).toBe("queued")
})

test("drops a queued draft when it is removed before the write lands", async () => {
  const documents = new Map<string, string>([["prompt", JSON.stringify({ prompt: [] })]])
  const store = createDraftStore({
    get: async (key) => documents.get(key) ?? null,
    set: async (key, value) => void documents.set(key, value),
    remove: async (key) => void documents.delete(key),
    putBlob: async () => "blob",
    getBlob: async () => null,
  })

  await store.setItem("prompt", JSON.stringify({ prompt: [{ type: "text", content: "typed" }] }))
  await store.removeItem("prompt")
  await store.flush()

  expect(documents.has("prompt")).toBe(false)
  expect(await store.getItem("prompt")).toBeNull()
})

test("keeps drafts for separate sessions independent", async () => {
  const documents = new Map<string, string>()
  const store = createDraftStore({
    get: async (key) => documents.get(key) ?? null,
    set: async (key, value) => void documents.set(key, value),
    remove: async (key) => void documents.delete(key),
    putBlob: async () => "blob",
    getBlob: async () => null,
  })

  await store.setItem("session-a", JSON.stringify({ prompt: [{ type: "text", content: "a" }] }))
  await store.setItem("session-b", JSON.stringify({ prompt: [{ type: "text", content: "b" }] }))
  await store.flush()

  expect(JSON.parse(documents.get("session-a")!).prompt[0].content).toBe("a")
  expect(JSON.parse(documents.get("session-b")!).prompt[0].content).toBe("b")
})
