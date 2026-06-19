import { beforeAll, describe, expect, mock, test } from "bun:test"
import { createStore } from "solid-js/store"
import type { DocMountInput } from "@/components/blocksuite/blocksuite-doc"
import type { PromptDocConfig } from "./doc"

const mounts: DocMountInput[] = []
const promptDocs: Array<{ sessionID: string; directory: string }> = []
let onSubmit: (() => void) | undefined

const handle = {
  attach: mock(async () => {}),
  detach: mock(() => {}),
  dispose: mock(async () => {}),
  setTheme: mock(() => {}),
  setActorIdentity: mock(() => {}),
  doc: {
    slots: {
      historyUpdated: {
        on: mock(() => ({ dispose: () => {} })),
      },
    },
  },
  onHistory: mock(() => {}),
  canUndo: () => false,
  canRedo: () => false,
  empty: () => true,
  actors: () => [],
  markdown: async () => ({ text: "", assets: [] }),
  collection: { id: "doc_1" },
}

mock.module("@/components/blocksuite/blocksuite-doc", () => ({
  createPage: mock(async (input: DocMountInput) => {
    mounts.push(input)
    onSubmit = input.onSubmit
    return handle
  }),
}))

let createPromptDoc: typeof import("./doc").createPromptDoc

beforeAll(async () => {
  ;({ createPromptDoc } = await import("./doc"))
})

const client = {
  session: {
    actor: {
      upsert: async () => ({
        data: { actorID: "act_1", name: "Test", color: "#3574D9" },
      }),
    },
    promptDoc: async (input: { sessionID: string; directory: string }) => {
      promptDocs.push(input)
      return { data: { docID: "doc_1" } }
    },
    promptDoc2: {
      advance: async () => ({ data: { docID: "doc_2" } }),
      ready: async () => ({ data: { docID: "doc_2" } }),
    },
  },
} as never

function config(overrides?: Partial<PromptDocConfig>): PromptDocConfig {
  return {
    sessionID: "session_1",
    url: "http://localhost:4096",
    directory: "/tmp/project",
    submitKey: "enter",
    ...overrides,
  }
}

describe("createPromptDoc plain props", () => {
  test("mount passes plain theme to createPage", async () => {
    mounts.length = 0
    const [store] = createStore(config())
    const doc = createPromptDoc({ config: store, client, onSubmit: () => {} })
    const el = document.createElement("div")
    await doc.mount({ el, theme: "light" })
    expect(mounts[0]?.theme).toBe("light")
  })

  test("setTheme updates stored theme before remount", async () => {
    mounts.length = 0
    const [store] = createStore(config())
    const doc = createPromptDoc({ config: store, client, onSubmit: () => {} })
    const el = document.createElement("div")
    await doc.mount({ el, theme: "light" })
    doc.setTheme("dark")
    await doc.pivot("session_1", "doc_2")
    expect(mounts.at(-1)?.theme).toBe("dark")
  })

  test("remount reads submitKey from config store", async () => {
    mounts.length = 0
    const [store, setStore] = createStore(config({ submitKey: "enter" }))
    const doc = createPromptDoc({ config: store, client, onSubmit: () => {} })
    const el = document.createElement("div")
    await doc.mount({ el, theme: "light" })
    setStore("submitKey", "mod+enter")
    await doc.pivot("session_1", "doc_2")
    expect(mounts.at(-1)?.submitKey).toBe("mod+enter")
  })

  test("onSubmit forwarded to createPage", async () => {
    mounts.length = 0
    let sent = 0
    const [store] = createStore(config())
    const doc = createPromptDoc({ config: store, client, onSubmit: () => sent++ })
    const el = document.createElement("div")
    await doc.mount({ el, theme: "light" })
    onSubmit?.()
    expect(sent).toBe(1)
  })

  test("config store sessionID read after await", async () => {
    promptDocs.length = 0
    const [store, setStore] = createStore(config({ sessionID: "session_1" }))
    const doc = createPromptDoc({ config: store, client, onSubmit: () => {} })
    const el = document.createElement("div")
    await doc.mount({ el, theme: "light" })
    setStore("sessionID", "session_2")
    await doc.refresh("session_2")
    expect(promptDocs.at(-1)?.sessionID).toBe("session_2")
  })
})
