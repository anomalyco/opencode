import { describe, expect, test } from "bun:test"
import type { AsyncStorage } from "@solid-primitives/storage"
import { createEffect, createRoot } from "solid-js"
import { createStore } from "solid-js/store"
import type { Platform } from "@/context/platform"
import { createPromptReady, createPromptSession } from "@/context/prompt-state"
import { ServerScope } from "@/utils/server-scope"
import { createDraftStore } from "@/utils/draft-store"
import { Persist, persisted } from "@/utils/persist"

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
  },
}

describe("prompt persistence", () => {
  test("relocates a previous V2 key into canonical storage", () => {
    localStorage.setItem("server.v3", JSON.stringify({ list: ["https://example.com"] }))

    const [state] = persisted(
      { ...Persist.global("server"), previousKey: "server.v3" },
      createStore({ list: [] as string[] }),
      platform,
    )

    expect(state.list).toEqual(["https://example.com"])
    expect(localStorage.getItem("opencode.global.dat:server")).toBe(JSON.stringify({ list: ["https://example.com"] }))
    expect(localStorage.getItem("server.v3")).toBeNull()
  })

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

  test("relocates a current prompt into the draft store", async () => {
    const documents = new Map<string, string>()
    const store = createDraftStore({
      get: async (key) => documents.get(key) ?? null,
      set: async (key, value) => void documents.set(key, value),
      remove: async (key) => void documents.delete(key),
      putBlob: async () => "blob",
      getBlob: async () => null,
    })
    const target = Persist.draft("draft-relocate", "prompt")
    const key = `${target.storage}:${target.key}`
    localStorage.setItem(
      key,
      JSON.stringify({
        prompt: [{ type: "text", content: "relocated draft", start: 0, end: 15 }],
        cursor: 15,
        context: { items: [] },
      }),
    )

    const session = createPromptSession(ServerScope.local, { draftID: "draft-relocate" }, undefined, {
      ...platform,
      draftStore: store,
    })
    await session.ready.promise

    expect(session.current()[0]).toMatchObject({ type: "text", content: "relocated draft" })
    expect(documents.get(key)).toContain("relocated draft")
    expect(localStorage.getItem(key)).toBeNull()
  })

  test("relocates a previous V2 prompt key into the draft store", async () => {
    const documents = new Map<string, string>()
    const store = createDraftStore({
      get: async (key) => documents.get(key) ?? null,
      set: async (key, value) => void documents.set(key, value),
      remove: async (key) => void documents.delete(key),
      putBlob: async () => "blob",
      getBlob: async () => null,
    })
    const dir = "encoded-directory"
    const oldKey = `${dir}/prompt.v2`
    const target = Persist.prompt(Persist.serverScoped(ServerScope.local, dir, undefined, "prompt"))
    const key = `${target.storage}:${target.key}`
    localStorage.setItem(
      oldKey,
      JSON.stringify({
        prompt: [{ type: "text", content: "previous V2 draft", start: 0, end: 17 }],
        cursor: 17,
        context: { items: [] },
      }),
    )

    const session = createPromptSession(ServerScope.local, { dir }, undefined, { ...platform, draftStore: store })
    await session.ready.promise

    expect(session.current()[0]).toMatchObject({ type: "text", content: "previous V2 draft" })
    expect(documents.get(key)).toContain("previous V2 draft")
    expect(localStorage.getItem(oldKey)).toBeNull()
  })
})

test("moves image data URLs into blobs and hydrates object URLs", async () => {
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
  const older = store.setItem(
    "prompt",
    JSON.stringify({ prompt: [{ type: "image", dataUrl: "data:image/png;base64,YQ==" }] }),
  )
  await Bun.sleep(0)
  await store.setItem("prompt", JSON.stringify({ prompt: [{ type: "text", content: "latest" }] }))
  migration.resolve()
  await older

  expect(documents.get("prompt")).toContain("latest")
})
