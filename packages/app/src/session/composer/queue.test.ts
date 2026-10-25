import { describe, expect, test } from "bun:test"
import type { SessionInboxInfo } from "@opencode/client/promise"
import { extractPromptFromMessage } from "@/composer/prompt"
import { blobDataUrl, setMediaBlobLoader } from "@/runtime/persistence/drafts"
import { queuedPromptAttachments, queuedPromptRows, undoQueuedPrompt } from "./queue"

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

const edit = { original: "msg_original", replacement: "msg_replacement" }

describe("queuedPromptRows", () => {
  test.each([
    ["keeps the edited prompt to one row while its replacement is admitted", queued, edit, [queued[1]]],
    ["keeps the original visible until its replacement appears", [queued[0]], edit, [queued[0]]],
    ["retains unrelated queue entries", queued, undefined, queued],
    [
      "keeps other prompts visible while a mutation replaces the edited prompt",
      [queued[0], other, queued[1]],
      edit,
      [other, queued[1]],
    ],
  ])("%s", (_name, items, replacement, visible) => {
    expect(queuedPromptRows(items, replacement)).toEqual(
      visible.map((item) => ({ id: item.id, text: item.payload.text, attachments: 0 })),
    )
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
      blob: { id: `media:${hash}`, url: `media:${hash}` },
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
      const failed = await undoQueuedPrompt({
        prompt: extracted,
        cancelInboxItem: async () => {
          events.push("cancelInboxItem")
        },
      }).catch((error: unknown) => error)
      expect(failed).toBeInstanceOf(Error)
      expect(events.slice(cancels)).toEqual([`load:${mediaUri}`])
    } finally {
      setMediaBlobLoader("queue-test", undefined)
    }
  })
})
