import { expect, test } from "bun:test"
import { createDraftStore } from "./draft-store"

test("restores a text attachment Blob without serializing its content into the draft", async () => {
  const documents = new Map<string, string>()
  const blobs = new Map<string, Blob>()
  const driver = {
    get: async (key: string) => documents.get(key) ?? null,
    set: async (key: string, value: string) => {
      documents.set(key, value)
    },
    remove: async (key: string) => {
      documents.delete(key)
    },
    putBlob: async (blob: Blob) => {
      const id = `blob-${blobs.size + 1}`
      blobs.set(id, blob)
      return id
    },
    getBlob: async (id: string) => blobs.get(id) ?? null,
  }
  const text = "first\n第二行\n"
  const writer = createDraftStore(driver)
  const blob = await writer.putBlob(new Blob([text], { type: "text/plain" }))
  await writer.setItem(
    "prompt",
    JSON.stringify({
      prompt: [
        {
          type: "text-attachment",
          id: "paste-1",
          filename: "pasted-text.txt",
          mime: "text/plain",
          size: blob.id.length,
          lineCount: 2,
          blob,
        },
      ],
    }),
  )

  expect(documents.get("prompt")).not.toContain(text)
  const restored = JSON.parse((await createDraftStore(driver).getItem("prompt"))!)
  expect(restored.prompt[0].blob.id).toBe(blob.id)
  expect(restored.prompt[0].blob.url).toContain("blob:")
})
