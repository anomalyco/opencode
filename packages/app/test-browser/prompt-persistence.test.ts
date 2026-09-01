import { describe, expect, test } from "bun:test"
import type { AsyncStorage } from "@solid-primitives/storage"
import { createEffect, createRoot } from "solid-js"
import { Schema } from "effect"
import type { Platform } from "@/runtime/platform/platform"
import { createComposerReady, createComposerState } from "@/composer/state"
import { ServerScope } from "@/runtime/server/scope"
import { createDraftStore } from "@/runtime/persistence/drafts"
import { Persist, persisted } from "@/runtime/persistence/storage"

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
  test.each([null, "null", '"invalid"', "not json"])(
    "keeps dynamic initial input with unavailable stored state: %s",
    async (raw) => {
      const store = createDraftStore({
        get: async () => raw,
        set: async () => undefined,
        remove: async () => undefined,
        putBlob: async () => "unused",
        getBlob: async () => null,
      })
      const model = { providerID: "provider", modelID: "model", variant: "high" }
      const root = createRoot((dispose) => ({
        dispose,
        session: createComposerState(
          ServerScope.local,
          { draftID: `draft-initial-${raw}` },
          { prompt: "initial prompt", model },
          { ...platform, draftStore: store },
        ),
      }))
      await root.session.ready.promise
      expect(root.session.current()).toEqual([{ type: "text", content: "initial prompt", start: 0, end: 14 }])
      expect(root.session.cursor()).toBe(14)
      expect(root.session.model.current()).toEqual(model)
      root.dispose()
    },
  )

  test("decodes hydrated images and writes canonical blob references through draft storage", async () => {
    const documents = new Map<string, string>()
    const blobs = new Map<string, Blob>()
    const store = createDraftStore({
      get: async (key) => documents.get(key) ?? null,
      set: async (key, value) => void documents.set(key, value),
      remove: async (key) => void documents.delete(key),
      putBlob: async (blob) => {
        blobs.set("composer-image", blob)
        return "composer-image"
      },
      getBlob: async (id) => blobs.get(id) ?? null,
    })
    const target = Persist.draft("draft-schema-image", "prompt")
    const key = `${target.storage}:${target.key}`
    await store.setItem(
      key,
      JSON.stringify({
        prompt: [
          {
            type: "image",
            id: "image",
            filename: "image.png",
            mime: "image/png",
            dataUrl: "data:image/png;base64,YQ==",
          },
        ],
      }),
    )
    const root = createRoot((dispose) => ({
      dispose,
      session: createComposerState(ServerScope.local, { draftID: "draft-schema-image" }, undefined, {
        ...platform,
        draftStore: store,
      }),
    }))
    await root.session.ready.promise
    expect(root.session.current()).toEqual([
      {
        type: "image",
        id: "image",
        filename: "image.png",
        mime: "image/png",
        blob: { id: "composer-image", url: expect.stringMatching(/^blob:/) },
      },
    ])
    root.session.set([{ type: "text", content: "hello", start: 0, end: 5 }, ...root.session.current()])
    await Bun.sleep(0)
    expect(documents.get(key)).toContain("hello")
    expect(documents.get(key)).toContain('"blob":{"id":"composer-image"}')
    expect(documents.get(key)).not.toContain("dataUrl")
    expect(documents.get(key)).not.toContain("blob:")
    root.dispose()
  })

  test("relocates a previous key into canonical storage", () => {
    localStorage.setItem("server.v3", JSON.stringify({ list: ["https://example.com"] }))

    const [state] = persisted(
      { ...Persist.global("server"), previousKey: "server.v3" },
      Schema.Struct({ list: Schema.mutable(Schema.Array(Schema.String)) }),
      { list: [] },
      platform,
    )

    expect(state.list).toEqual(["https://example.com"])
    expect(localStorage.getItem("opencode.global.dat:server")).toBe(JSON.stringify({ list: ["https://example.com"] }))
    expect(localStorage.getItem("server.v3")).toBeNull()
  })

  test("waits for an async draft to hydrate before reporting ready", async () => {
    await new Promise<void>((resolve, reject) => {
      createRoot((dispose) => {
        const session = createComposerState(ServerScope.local, { draftID: "draft-async" }, undefined, platform)
        const ready = createComposerReady(() => session)

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

    const session = createComposerState(ServerScope.local, { draftID: "draft-relocate" }, undefined, {
      ...platform,
      draftStore: store,
    })
    await session.ready.promise

    expect(session.current()[0]).toMatchObject({ type: "text", content: "relocated draft" })
    expect(documents.get(key)).toContain("relocated draft")
    expect(localStorage.getItem(key)).toBeNull()
  })

  test("relocates a previous prompt key into the draft store", async () => {
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
        prompt: [{ type: "text", content: "previous draft", start: 0, end: 14 }],
        cursor: 17,
        context: { items: [] },
      }),
    )

    const session = createComposerState(ServerScope.local, { dir }, undefined, { ...platform, draftStore: store })
    await session.ready.promise

    expect(session.current()[0]).toMatchObject({ type: "text", content: "previous draft" })
    expect(documents.get(key)).toContain("previous draft")
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
