import { describe, expect, test } from "bun:test"
import type { SessionInboxInfo } from "@opencode/client/promise"
import { extractPromptFromMessage } from "@/composer/prompt"
import { blobDataUrl, setMediaBlobLoader } from "@/runtime/persistence/drafts"
import { queuedPromptAttachments, queuedPromptRows, undoQueuedPrompt, type SentEdit } from "./queue"

const queued = [
  {
    id: "msg_original",
    sessionID: "ses_1",
    time: { created: 1 },
    type: "user",
    delivery: "queue",
    payload: { text: "original" },
  },
  {
    id: "msg_replacement",
    sessionID: "ses_1",
    time: { created: 2 },
    type: "user",
    delivery: "queue",
    payload: { text: "edited" },
  },
] satisfies SessionInboxInfo[]

const other = { ...queued[0], id: "msg_other", payload: { text: "other" } }

const later = { ...queued[0], id: "msg_later", payload: { text: "later" } }

const laterCopy = { ...later, id: "msg_later_copy" }

const sent = (change: Partial<SentEdit> = {}): SentEdit => ({
  original: "msg_original",
  delivery: "queue",
  text: "edited",
  attachments: 1,
  moved: { msg_original: "msg_replacement", msg_later: "msg_later_copy" },
  admitted: false,
  ...change,
})

const row = (item: (typeof queued)[number], pending?: boolean) => ({
  id: item.id,
  text: item.payload.text,
  attachments: 0,
  pending,
})

const edited = (id: string) => ({ id, text: "edited", attachments: 1, pending: true })

// One edit's life in the strip: sent from the composer, re-admitted by the server, its originals
// cancelled last first, then settled once the server's queue reflects it, or rolled back on failure.
describe("queuedPromptRows", () => {
  test.each([
    [
      "shows a sent edit on the original row and marks the rows it rewrites as pending",
      [other, queued[0], later],
      [sent()],
      [row(other), edited("msg_original"), row(later, true)],
    ],
    [
      "hides re-admitted copies while their originals are listed",
      [other, queued[0], later, queued[1], laterCopy],
      [sent()],
      [row(other), edited("msg_original"), row(later, true)],
    ],
    [
      "keeps the order as the originals are cancelled last first",
      [other, queued[0], queued[1], laterCopy],
      [sent({ admitted: true })],
      [row(other), edited("msg_original"), row(laterCopy, true)],
    ],
    [
      "shows the edit on its replacement once the original is gone",
      [other, queued[1], laterCopy],
      [sent({ admitted: true })],
      [row(other), edited("msg_replacement"), row(laterCopy, true)],
    ],
    [
      "drops the original row once a steered edit is admitted",
      [queued[0], other],
      [sent({ delivery: "steer", moved: { msg_original: "msg_replacement" }, admitted: true })],
      [row(other)],
    ],
    ["shows the server's queue once the edit settles", [other, queued[1]], [], [row(other), row(queued[1])]],
    ["restores the original row when a failed edit settles", [queued[0], other], [], [row(queued[0]), row(other)]],
  ])("%s", (_name, items, edits, visible) => {
    expect(queuedPromptRows(items, edits)).toEqual(visible)
  })

  test("shows each of several edits in flight on its own row", () => {
    const second = sent({ original: "msg_other", text: "other edited", moved: { msg_other: "msg_other_copy" } })

    expect(queuedPromptRows([queued[0], other, later], [sent(), second])).toEqual([
      edited("msg_original"),
      { id: "msg_other", text: "other edited", attachments: 1, pending: true },
      row(later, true),
    ])
  })

  test("hides prompts the server confirmed gone until its events catch up", () => {
    expect(queuedPromptRows([queued[0], other], [], ["msg_original"])).toEqual([row(other)])
  })
})

describe("queuedPromptAttachments", () => {
  test("returns inline attachments as composer image parts", () => {
    const item = {
      ...queued[0],
      payload: {
        text: "",
        files: [
          { data: "aGk=", mime: "image/png", source: { type: "inline" as const }, name: "shot.png" },
          { data: "aGk=", mime: "application/pdf", source: { type: "inline" as const } },
        ],
      },
    } satisfies SessionInboxInfo

    expect(queuedPromptAttachments(item)).toEqual([
      {
        type: "image",
        id: "msg_original:file:0",
        filename: "shot.png",
        mime: "image/png",
        blob: { id: "data:image/png;base64,aGk=", url: "data:image/png;base64,aGk=" },
      },
      {
        type: "image",
        id: "msg_original:file:1",
        filename: "attachment",
        mime: "application/pdf",
        blob: { id: "data:application/pdf;base64,aGk=", url: "data:application/pdf;base64,aGk=" },
      },
    ])
  })

  test("undoQueuedPrompt pins media:<hash> attachments locally before inbox.cancel sweeps the server blob", async () => {
    const hash = "e".repeat(64)
    const mediaUri = `media:${hash}`
    const pngBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="
    const pngBytes = Uint8Array.from(Buffer.from(pngBase64, "base64"))
    const blobs = new Map<string, Uint8Array>([[hash, pngBytes]])
    const events: string[] = []

    const extracted = extractPromptFromMessage({
      id: "msg_queued_media",
      text: "queued with image",
      files: [
        {
          uri: mediaUri,
          mime: "image/png",
          source: { type: "inline" },
          width: 1,
          height: 1,
          bytes: pngBytes.byteLength,
          name: "shot.png",
        },
      ],
    })

    expect(extracted.find((part) => part.type === "image")).toMatchObject({
      blob: { id: `media:${hash}`, url: "" },
    })
    expect(JSON.stringify(extracted)).not.toContain("/api/")

    // The server's media cache, as `client.tsx` registers it: a URL for the bytes while the server still has them.
    setMediaBlobLoader("queue-test", async (uri) => {
      events.push(`load:${uri}`)
      const found = blobs.get(uri.slice("media:".length))

      return found ? `data:image/png;base64,${Buffer.from(found).toString("base64")}` : undefined
    })

    try {
      const pinned = await undoQueuedPrompt({
        prompt: extracted,
        cancelInboxItem: async () => {
          events.push("cancelInboxItem")
          // The cancel releases the item's blob refs and sweeps the blob nothing else references.
          blobs.delete(hash)
        },
      })

      expect(events).toEqual([`load:${mediaUri}`, "cancelInboxItem"])
      expect(blobs.has(hash)).toBe(false)

      const imagePart = pinned.find((part) => part.type === "image")
      expect(imagePart?.type).toBe("image")

      if (imagePart?.type !== "image") return
      expect(imagePart.blob.id).not.toStartWith("media:")
      expect(await blobDataUrl(imagePart.blob, imagePart.mime)).toBe(`data:image/png;base64,${pngBase64}`)

      // Media nothing serves anymore fails the pin, so the item is never cancelled.
      const cancels = events.length

      await expect(
        undoQueuedPrompt({
          prompt: extracted,
          cancelInboxItem: async () => {
            events.push("cancelInboxItem")
          },
        }),
      ).rejects.toBeInstanceOf(Error)
      expect(events.slice(cancels)).toEqual([`load:${mediaUri}`])
    } finally {
      setMediaBlobLoader("queue-test", undefined)
    }
  })
})
