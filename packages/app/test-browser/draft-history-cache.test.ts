import { expect, test } from "bun:test"
import { resolveObjectURL } from "node:buffer"
import { createDraftStore } from "@/runtime/persistence/drafts"

function fixture(id: string, getBlob: () => Promise<Blob | null>) {
  const documents = new Map([
    ["history", JSON.stringify({ entries: [{ prompt: [{ type: "image", blob: { id } }] }] })],
    ["draft", JSON.stringify({ prompt: [{ type: "image", blob: { id } }] })],
  ])
  const store = createDraftStore({
    get: async (key) => documents.get(key) ?? null,
    set: async (key, value) => void documents.set(key, value),
    remove: async (key) => void documents.delete(key),
    putBlob: async () => id,
    getBlob,
  })
  return { store, documents }
}

test("deduplicates concurrent history and draft reads without invalidating either live reference", async () => {
  const pending = Promise.withResolvers<Blob | null>()
  const started = Promise.withResolvers<void>()
  let reads = 0
  const { store } = fixture("history-cache-concurrent", () => {
    reads++
    started.resolve()
    return pending.promise
  })
  const history = store.getItem("history")
  const draft = store.getItem("draft")
  await started.promise
  pending.resolve(new Blob(["shared screenshot"]))
  const [saved, active] = await Promise.all([history, draft])
  const reference = JSON.parse(saved!).entries[0].prompt[0].blob
  expect(JSON.parse(active!).prompt[0].blob).toEqual(reference)
  expect(reads).toBe(1)
  await store.removeItem("history")
  expect(await resolveObjectURL(reference.url)?.text()).toBe("shared screenshot")
  expect(JSON.parse((await store.getItem("draft"))!).prompt[0].blob).toEqual(reference)
  expect(reads).toBe(1)
})

test("hydrates repeated references once within one history document", async () => {
  let reads = 0
  const { store, documents } = fixture("history-cache-repeated", async () => {
    reads++
    return new Blob(["repeated screenshot"])
  })
  documents.set(
    "history",
    JSON.stringify({
      entries: Array.from({ length: 100 }, () => ({
        prompt: [{ type: "image", blob: { id: "history-cache-repeated" } }],
      })),
    }),
  )
  const value = JSON.parse((await store.getItem("history"))!)
  expect(value.entries).toHaveLength(100)
  expect(
    new Set(value.entries.map((entry: { prompt: { blob: { url: string } }[] }) => entry.prompt[0].blob.url)).size,
  ).toBe(1)
  expect(reads).toBe(1)
})

test("reuses a live URL on remount but reads the latest document", async () => {
  let reads = 0
  const { store, documents } = fixture("history-cache-remount", async () => {
    reads++
    return new Blob(["saved screenshot"])
  })
  const first = JSON.parse((await store.getItem("history"))!)
  const changed = JSON.parse(documents.get("history")!)
  changed.entries[0].prompt.unshift({ type: "text", content: "new admission" })
  documents.set("history", JSON.stringify(changed))
  const second = JSON.parse((await store.getItem("history"))!)
  expect(second.entries[0].prompt[0].content).toBe("new admission")
  expect(second.entries[0].prompt[1].blob).toEqual(first.entries[0].prompt[0].blob)
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
  expect(reads).toBe(0)
  expect(await resolveObjectURL(reference.url)?.text()).toBe("pending admission")
})

test("does not retain a missing blob result", async () => {
  let reads = 0
  const { store } = fixture("history-cache-missing", async () => (++reads === 1 ? null : new Blob(["arrived"])))
  expect(JSON.parse((await store.getItem("draft"))!).prompt[0].blob.url).toBeUndefined()
  expect(JSON.parse((await store.getItem("draft"))!).prompt[0].blob.url).toStartWith("blob:")
  expect(reads).toBe(2)
})

test("retries after a failed blob read", async () => {
  let reads = 0
  const { store } = fixture("history-cache-failure", async () => {
    if (++reads === 1) throw new Error("temporary storage failure")
    return new Blob(["recovered"])
  })
  await expect(store.getItem("history")).rejects.toThrow("temporary storage failure")
  expect(JSON.parse((await store.getItem("history"))!).entries[0].prompt[0].blob.url).toStartWith("blob:")
  expect(reads).toBe(2)
})

test("keeps different blob IDs independent", async () => {
  const reads: string[] = []
  const store = createDraftStore({
    get: async () => JSON.stringify(["history-cache-first", "history-cache-second"].map((id) => ({ blob: { id } }))),
    set: async () => {},
    remove: async () => {},
    putBlob: async () => "unused",
    getBlob: async (id) => {
      reads.push(id)
      return new Blob([id])
    },
  })
  const value = JSON.parse((await store.getItem("history"))!)
  expect(value[0].blob.url).not.toBe(value[1].blob.url)
  expect(
    await Promise.all(value.map((item: { blob: { url: string } }) => resolveObjectURL(item.blob.url)?.text())),
  ).toEqual(reads)
  expect(reads).toEqual(["history-cache-first", "history-cache-second"])
})
