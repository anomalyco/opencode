import { expect, test } from "bun:test"
import type { PromptFileAttachment, SessionMessageUser } from "@opencode/client/promise"
import { createAttachmentReader } from "./attachment"

const original: SessionMessageUser = {
  id: "msg_original",
  type: "user",
  text: "keep these",
  time: { created: 1 },
  files: [{ name: "image.png", mime: "image/png", data: "AQID", source: { type: "inline" } }],
}

const reference: PromptFileAttachment = {
  name: "image.png",
  mime: "image/png",
  data: "",
  source: { type: "uri", uri: "opencode-attachment:ses_test/msg_original/0" },
}

test("display, remount and prompt restoration share one original, including offline", async () => {
  const response = Promise.withResolvers<SessionMessageUser>()
  let calls = 0

  const reader = createAttachmentReader(async () => {
    calls++

    if (calls > 1) throw new Error("offline")

    return response.promise
  })

  const first = reader.file(reference)
  const concurrent = reader.file({ ...reference })
  response.resolve(original)
  expect(await first).toEqual(original.files![0])
  expect(await concurrent).toEqual(original.files![0])
  expect(await reader.file({ ...reference })).toEqual(original.files![0])
  expect(await reader.hydrate("ses_test", { ...original, files: [reference] })).toEqual(original)
  expect(calls).toBe(1)
})

test("failed reads retry and resolved entries are LRU-bounded by count and byte size", async () => {
  const calls: string[] = []

  const reader = createAttachmentReader(async ({ messageID }) => {
    calls.push(messageID)

    if (calls.length === 1) throw new Error("offline")

    return { ...original, id: messageID, text: messageID === "msg_large" ? "x".repeat(9 * 1024 * 1024) : original.text }
  })

  const read = (messageID: string) => reader.hydrate("ses_test", { ...original, id: messageID, files: [reference] })
  await expect(read("msg_0")).rejects.toThrow("offline")

  for (const index of Array.from({ length: 32 }, (_, index) => index)) await read(`msg_${index}`)
  await read("msg_0") // Touch the oldest; the next addition must evict msg_1 instead.
  await read("msg_32")
  const before = calls.length
  await read("msg_0")
  expect(calls.length).toBe(before)
  await read("msg_1")
  expect(calls.length).toBe(before + 1)
  await read("msg_large")
  await read("msg_large")
  expect(calls.filter((id) => id === "msg_large")).toHaveLength(2)
})
