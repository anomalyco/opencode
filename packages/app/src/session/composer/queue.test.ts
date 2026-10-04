import { SessionID } from "@opencode/schema/session-id"
import { SessionMessage } from "@opencode/schema/session-message"
import { describe, expect, test } from "bun:test"
import type { SessionInboxInfo } from "@opencode/client/promise"
import { queuedPromptAttachments, queuedPromptRows } from "./queue"

const queued = [
  {
    id: SessionMessage.ID.make("msg_original", { disableChecks: true }),
    sessionID: SessionID.make("ses_1", { disableChecks: true }),
    time: { created: 1 },
    type: "user",
    delivery: "queue",
    payload: { text: "original" },
  },
  {
    id: SessionMessage.ID.make("msg_replacement", { disableChecks: true }),
    sessionID: SessionID.make("ses_1", { disableChecks: true }),
    time: { created: 2 },
    type: "user",
    delivery: "queue",
    payload: { text: "edited" },
  },
] satisfies SessionInboxInfo[]
const other = {
  ...queued[0],
  id: SessionMessage.ID.make("msg_other", { disableChecks: true }),
  payload: { text: "other" },
}
const edit = {
  original: SessionMessage.ID.make("msg_original", { disableChecks: true }),
  replacement: SessionMessage.ID.make("msg_replacement", { disableChecks: true }),
}

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
})
