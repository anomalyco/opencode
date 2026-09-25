import { describe, expect, test } from "bun:test"
import type { SessionInboxInfo } from "@opencode/client/promise"
import { queuedPromptAttachments, queuedPromptRows } from "./queue"

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

describe("queuedPromptRows", () => {
  test("keeps the edited prompt to one row while its replacement is admitted", () => {
    expect(queuedPromptRows(queued, { original: "msg_original", replacement: "msg_replacement" })).toEqual([
      { id: "msg_replacement", text: "edited", attachments: 0 },
    ])
  })

  test("keeps the original visible until its replacement appears", () => {
    expect(queuedPromptRows([queued[0]], { original: "msg_original", replacement: "msg_replacement" })).toEqual([
      { id: "msg_original", text: "original", attachments: 0 },
    ])
  })

  test("retains unrelated queue entries", () => {
    expect(queuedPromptRows(queued)).toEqual([
      { id: "msg_original", text: "original", attachments: 0 },
      { id: "msg_replacement", text: "edited", attachments: 0 },
    ])
  })

  test("keeps other prompts visible while a mutation replaces the edited prompt", () => {
    const other = { ...queued[0], id: "msg_other", payload: { text: "other" } }

    expect(
      queuedPromptRows([queued[0], other, queued[1]], { original: "msg_original", replacement: "msg_replacement" }),
    ).toEqual([
      { id: "msg_other", text: "other", attachments: 0 },
      { id: "msg_replacement", text: "edited", attachments: 0 },
    ])
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

  test("leaves file mentions and context files in the payload", () => {
    const item = {
      ...queued[0],
      payload: {
        text: "see @src/a.ts",
        files: [
          {
            data: "aGk=",
            mime: "text/plain",
            source: { type: "inline" as const },
            mention: { start: 4, end: 13, text: "@src/a.ts" },
          },
          { data: "aGk=", mime: "text/plain", source: { type: "uri" as const, uri: "file:///src/b.ts" } },
        ],
      },
    } satisfies SessionInboxInfo

    expect(queuedPromptAttachments(item)).toEqual([])
  })
})
