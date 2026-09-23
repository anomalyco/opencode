import { expect, test } from "bun:test"
import { resolveObjectURL } from "node:buffer"
import { createDraftStore, resolveBlobUrl } from "@/runtime/persistence/drafts"

function fixture(id: string, getBlob: () => Promise<Blob | null>) {
  const documents = new Map([
    ["history", JSON.stringify({ entries: [{ prompt: [{ type: "image", blob: { id } }] }] })],
    ["draft", JSON.stringify({ prompt: [{ type: "image", blob: { id } }] })],
  ])
  const store = createDraftStore({
    get: async (key) => documents.get(key) ?? null,
    set: async (key, value) => {
      documents.set(key, value)
      return []
    },
    remove: async (key) => void documents.delete(key),
    putBlob: async () => id,
    getBlob,
  })
  return { store, documents }
}

test("loading history and a draft reads no image bytes", async () => {
  let reads = 0
  const { store } = fixture("history-cache-lazy", async () => {
    reads++
    return new Blob(["shared screenshot"])
  })
  const [history, draft] = await Promise.all([store.getItem("history"), store.getItem("draft")])
  expect(JSON.parse(history!).entries[0].prompt[0].blob).toEqual({ id: "history-cache-lazy" })
  expect(JSON.parse(draft!).prompt[0].blob).toEqual({ id: "history-cache-lazy" })
  expect(reads).toBe(0)
})

test("deduplicates concurrent resolves without invalidating either live reference", async () => {
  const pending = Promise.withResolvers<Blob | null>()
  const started = Promise.withResolvers<void>()
  let reads = 0
  const { store } = fixture("history-cache-concurrent", () => {
    reads++
    started.resolve()
    return pending.promise
  })
  await store.getItem("history")
  const first = resolveBlobUrl({ id: "history-cache-concurrent" })
  const second = resolveBlobUrl({ id: "history-cache-concurrent" })
  await started.promise
  pending.resolve(new Blob(["shared screenshot"]))
  const [a, b] = await Promise.all([first, second])
  expect(a).toBe(b!)
  expect(reads).toBe(1)
  await store.removeItem("history")
  expect(await resolveObjectURL(a!)?.text()).toBe("shared screenshot")
  expect(await resolveBlobUrl({ id: "history-cache-concurrent" })).toBe(a!)
  expect(reads).toBe(1)
})

test("a document re-read while its image is live gets the URL back without a read", async () => {
  let reads = 0
  const { store, documents } = fixture("history-cache-remount", async () => {
    reads++
    return new Blob(["saved screenshot"])
  })
  const url = await resolveBlobUrl({ id: "history-cache-remount" })
  const changed = JSON.parse(documents.get("history")!)
  changed.entries[0].prompt.unshift({ type: "text", content: "new admission" })
  documents.set("history", JSON.stringify(changed))
  const second = JSON.parse((await store.getItem("history"))!)
  expect(second.entries[0].prompt[0].content).toBe("new admission")
  expect(second.entries[0].prompt[1].blob).toEqual({ id: "history-cache-remount", url })
  expect(reads).toBe(1)
})

test("reuses a just-stored attachment without a round trip", async () => {
  let reads = 0
  const { store } = fixture("history-cache-put", async () => {
    reads++
    return new Blob(["unexpected read"])
  })
  const reference = await store.putBlob(new Blob(["pending admission"]))
  expect(JSON.parse((await store.getItem("draft"))!).prompt[0].blob).toEqual(reference)
  expect(await resolveBlobUrl({ id: reference.id })).toBe(reference.url)
  expect(reads).toBe(0)
  expect(await resolveObjectURL(reference.url)?.text()).toBe("pending admission")
})

test("does not retain a missing blob result", async () => {
  let reads = 0
  fixture("history-cache-missing", async () => (++reads === 1 ? null : new Blob(["arrived"])))
  expect(await resolveBlobUrl({ id: "history-cache-missing" })).toBeUndefined()
  expect(await resolveBlobUrl({ id: "history-cache-missing" })).toStartWith("blob:")
  expect(reads).toBe(2)
})

test("retries after a failed blob read", async () => {
  let reads = 0
  fixture("history-cache-failure", async () => {
    if (++reads === 1) throw new Error("temporary storage failure")
    return new Blob(["recovered"])
  })
  await expect(resolveBlobUrl({ id: "history-cache-failure" })).rejects.toThrow("temporary storage failure")
  expect(await resolveBlobUrl({ id: "history-cache-failure" })).toStartWith("blob:")
  expect(reads).toBe(2)
})

test("keeps different blob IDs independent", async () => {
  const reads: string[] = []
  createDraftStore({
    get: async () => null,
    set: async () => [],
    remove: async () => {},
    putBlob: async () => "unused",
    getBlob: async (id) => {
      reads.push(id)
      return new Blob([id])
    },
  })
  const urls = await Promise.all(["history-cache-first", "history-cache-second"].map((id) => resolveBlobUrl({ id })))
  expect(urls[0]).not.toBe(urls[1])
  expect(await Promise.all(urls.map((url) => resolveObjectURL(url!)?.text()))).toEqual(reads)
  expect(reads).toEqual(["history-cache-first", "history-cache-second"])
})
