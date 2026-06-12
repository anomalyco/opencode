import { beforeAll, describe, expect, test } from "bun:test"
import type { Message, QuestionRequest } from "@opencode-ai/sdk/v2/client"

let questionAnswered: typeof import("./session-question-dock-helpers").questionAnswered
let questionAttachments: typeof import("./session-question-dock-helpers").questionAttachments
let questionInvalidation: typeof import("./session-question-dock-helpers").questionInvalidation
let questionReply: typeof import("./session-question-dock-helpers").questionReply
let questionRequestNotFound: typeof import("./session-question-dock-helpers").questionRequestNotFound
let permissionRequestNotFound: typeof import("./session-question-dock-helpers").permissionRequestNotFound

beforeAll(async () => {
  const mod = await import("./session-question-dock-helpers")
  questionAnswered = mod.questionAnswered
  questionAttachments = mod.questionAttachments
  questionInvalidation = mod.questionInvalidation
  questionReply = mod.questionReply
  questionRequestNotFound = mod.questionRequestNotFound
  permissionRequestNotFound = mod.permissionRequestNotFound
})

const request = (messageID?: string) =>
  ({
    id: "que_1",
    sessionID: "ses_1",
    tool: messageID ? { messageID } : undefined,
    questions: [],
  }) as QuestionRequest

const message = (input: { id: string; role?: "assistant" | "user"; error?: boolean }) =>
  ({
    id: input.id,
    sessionID: "ses_1",
    role: input.role ?? "assistant",
    time: { created: 1 },
    error: input.error ? { message: "boom" } : undefined,
  }) as Message

describe("session question dock helpers", () => {
  test("marks custom answers with images as answered even after editing closes", () => {
    expect(
      questionAnswered([], "", true, [
        {
          type: "image",
          id: "img_1",
          mime: "image/png",
          dataUrl: "data:image/png;base64,AAAA",
          filename: "proof.png",
        },
      ]),
    ).toBe(true)
  })

  test("maps stored images into preview attachments", () => {
    expect(
      questionAttachments([
        {
          type: "image",
          id: "img_1",
          mime: "image/png",
          dataUrl: "data:image/png;base64,AAAA",
          filename: "proof.png",
        },
      ]),
    ).toEqual([
      {
        type: "image",
        id: "img_1",
        mime: "image/png",
        filename: "proof.png",
        dataUrl: "data:image/png;base64,AAAA",
      },
    ])
  })

  test("merges text answers and image answers for reply payload", () => {
    expect(
      questionReply(
        [
          {
            question: "Test image paste",
            header: "Image",
            options: [{ label: "ok", description: "ok" }],
          },
        ],
        [["details"]],
        [
          [
            {
              type: "image",
              id: "img_1",
              mime: "image/png",
              dataUrl: "data:image/png;base64,BBBB",
              filename: "proof.png",
            },
          ],
        ],
      ),
    ).toEqual([
      ["details", { type: "image", mime: "image/png", url: "data:image/png;base64,BBBB", filename: "proof.png" }],
    ])
  })

  test("normalizes nested image data urls for reply payload", () => {
    expect(
      questionReply(
        [
          {
            question: "Test image paste",
            header: "Image",
            options: [{ label: "ok", description: "ok" }],
          },
        ],
        [[]],
        [
          [
            {
              type: "image",
              id: "img_1",
              mime: "image/png",
              dataUrl: "data:image/png;base64,data:image/png;base64,BBBB",
              filename: "proof.png",
            },
          ],
        ],
      ),
    ).toEqual([[{ type: "image", mime: "image/png", url: "data:image/png;base64,BBBB", filename: "proof.png" }]])
  })

  test("recognizes stale question request errors as already handled", () => {
    const error = new Error("Question request not found: que_1", {
      cause: {
        body: {
          _tag: "QuestionNotFoundError",
          requestID: "que_1",
          message: "Question request not found: que_1",
        },
        status: 404,
      },
    })

    expect(questionRequestNotFound(error, "que_1")).toBe(true)
    expect(questionRequestNotFound(error, "que_2")).toBe(false)
  })

  test("recognizes stale permission request errors as already handled", () => {
    const error = new Error("Permission request not found: per_1", {
      cause: {
        body: {
          _tag: "PermissionNotFoundError",
          requestID: "per_1",
          message: "Permission request not found: per_1",
        },
        status: 404,
      },
    })

    expect(permissionRequestNotFound(error, "per_1")).toBe(true)
    expect(permissionRequestNotFound(error, "per_2")).toBe(false)
  })

  test("does not invalidate a question without a source message", () => {
    expect(questionInvalidation(request(), [message({ id: "msg_1" })])).toBeUndefined()
    expect(questionInvalidation(request("msg_missing"), [message({ id: "msg_1" })])).toBeUndefined()
  })

  test("invalidates a question when a later message supersedes its source", () => {
    expect(questionInvalidation(request("msg_z"), [message({ id: "msg_z" }), message({ id: "msg_a" })])).toEqual({
      type: "superseded",
      messageID: "msg_a",
    })
  })

  test("invalidates a question when the source assistant session ended", () => {
    expect(questionInvalidation(request("msg_1"), [message({ id: "msg_1", error: true })])).toEqual({
      type: "session-ended",
      messageID: "msg_1",
    })
  })
})
