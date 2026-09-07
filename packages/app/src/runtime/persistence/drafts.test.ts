import { describe, expect, test } from "bun:test"
import { createDraftStore, draftTextChunk, draftTextThreshold } from "./drafts"

function memoryDriver() {
  const documents = new Map<string, string>()
  const blobs = new Map<string, Blob>()
  let puts = 0
  return {
    documents,
    blobs,
    puts: () => puts,
    driver: {
      get: async (key: string) => documents.get(key) ?? null,
      set: async (key: string, value: string) => void documents.set(key, value),
      remove: async (key: string) => void documents.delete(key),
      putBlob: async (blob: Blob) => {
        puts++
        const id = `blob-${await blob.text().then((text) => Bun.hash(text).toString(16))}`
        blobs.set(id, blob)
        return id
      },
      getBlob: async (id: string) => blobs.get(id) ?? null,
    },
  }
}

const large = "x".repeat(draftTextThreshold)
const paste = Array.from({ length: 3 * draftTextChunk }, (_, i) => String.fromCharCode(97 + (i % 26))).join("")

describe("draft store text externalization", () => {
  test("large strings become chunk lists and small ones stay inline", async () => {
    const memory = memoryDriver()
    const store = createDraftStore(memory.driver)
    await store.setDocument("doc", {
      prompt: [
        { type: "text", content: paste },
        { type: "text", content: "hi" },
      ],
    })
    const stored = JSON.parse(memory.documents.get("doc")!)
    expect(stored.prompt[0].content.blob.kind).toBe("text")
    expect(stored.prompt[0].content.blob.ids).toHaveLength(3)
    expect(stored.prompt[1].content).toBe("hi")
    expect(memory.documents.get("doc")!.length).toBeLessThan(400)
    const chunks = await Promise.all(
      stored.prompt[0].content.blob.ids.map((id: string) => memory.blobs.get(id)!.text()),
    )
    expect(chunks.join("")).toBe(paste)
  })

  test("appending to a large string re-uploads only the final chunk", async () => {
    const memory = memoryDriver()
    const store = createDraftStore(memory.driver)
    await store.setDocument("doc", { prompt: [{ type: "text", content: paste }] })
    expect(memory.puts()).toBe(3)
    await store.setDocument("doc", { prompt: [{ type: "text", content: `${paste}!` }] })
    expect(memory.puts()).toBe(4)
    await store.setDocument("doc", { prompt: [{ type: "text", content: `${paste}!` }], cursor: 1 })
    expect(memory.puts()).toBe(4)
  })

  test("reads join the chunks again and reuse cached content", async () => {
    const memory = memoryDriver()
    const store = createDraftStore(memory.driver)
    await store.setDocument("doc", { prompt: [{ type: "text", content: paste }] })
    const fresh = createDraftStore(memory.driver)
    expect(JSON.parse((await fresh.getItem("doc"))!)).toEqual({ prompt: [{ type: "text", content: paste }] })
    memory.blobs.clear()
    expect(JSON.parse((await fresh.getItem("doc"))!)).toEqual({ prompt: [{ type: "text", content: paste }] })
  })

  test("a missing chunk decodes to empty text instead of failing the document", async () => {
    const memory = memoryDriver()
    memory.documents.set(
      "doc",
      JSON.stringify({ prompt: [{ type: "text", content: { blob: { kind: "text", ids: ["gone"] } } }] }),
    )
    const store = createDraftStore(memory.driver)
    expect(JSON.parse((await store.getItem("doc"))!)).toEqual({ prompt: [{ type: "text", content: "" }] })
  })

  test("setItem still accepts a serialized document", async () => {
    const memory = memoryDriver()
    const store = createDraftStore(memory.driver)
    await store.setItem("doc", JSON.stringify({ prompt: [{ type: "text", content: large }] }))
    expect(JSON.parse(memory.documents.get("doc")!).prompt[0].content.blob.ids).toHaveLength(1)
  })
})
