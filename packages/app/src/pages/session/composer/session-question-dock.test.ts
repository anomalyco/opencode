import { beforeAll, describe, expect, test } from "bun:test"

let questionAnswered: typeof import("./session-question-dock-helpers").questionAnswered
let questionAttachments: typeof import("./session-question-dock-helpers").questionAttachments
let questionReply: typeof import("./session-question-dock-helpers").questionReply

beforeAll(async () => {
  const mod = await import("./session-question-dock-helpers")
  questionAnswered = mod.questionAnswered
  questionAttachments = mod.questionAttachments
  questionReply = mod.questionReply
})

describe("session question dock helpers", () => {
  test("marks custom answers with images as answered even after editing closes", () => {
    expect(
      questionAnswered([], "", true, [
        { type: "image", id: "img_1", mime: "image/png", url: "data:image/png;base64,AAAA", filename: "proof.png" },
      ]),
    ).toBe(true)
  })

  test("maps stored images into preview attachments", () => {
    expect(
      questionAttachments([
        { type: "image", id: "img_1", mime: "image/png", url: "data:image/png;base64,AAAA", filename: "proof.png" },
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
        [[{ type: "image", id: "img_1", mime: "image/png", url: "data:image/png;base64,BBBB", filename: "proof.png" }]],
      ),
    ).toEqual([
      ["details", { type: "image", mime: "image/png", url: "data:image/png;base64,BBBB", filename: "proof.png" }],
    ])
  })
})
