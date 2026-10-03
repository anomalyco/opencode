import { describe, expect, test } from "bun:test"
import type { Part } from "@opencode-ai/sdk/v2"
import { extractPromptFromParts } from "./prompt"

const mentionedFileParts = (url: string) =>
  [
    {
      id: "text_1",
      type: "text",
      text: "@src/a.ts",
      sessionID: "ses_1",
      messageID: "msg_1",
    },
    {
      id: "file_1",
      type: "file",
      mime: "text/plain",
      url,
      filename: "a.ts",
      sessionID: "ses_1",
      messageID: "msg_1",
      source: {
        type: "file",
        path: "src/a.ts",
        text: { value: "@src/a.ts", start: 0, end: 9 },
      },
    },
  ] satisfies Part[]

describe("extractPromptFromParts", () => {
  test("does not restore a selection from unrelated file URL queries", () => {
    expect(extractPromptFromParts(mentionedFileParts("file:///repo/src/a.ts?preview=1"))[0]).toMatchObject({
      type: "file",
      selection: undefined,
    })
  })

  test("restores a selection from explicit file URL line parameters", () => {
    expect(extractPromptFromParts(mentionedFileParts("file:///repo/src/a.ts?start=10&end=20"))[0]).toMatchObject({
      type: "file",
      selection: { startLine: 10, endLine: 20, startChar: 0, endChar: 0 },
    })
  })

  test("restores multiple uploaded attachments", () => {
    const parts = [
      {
        id: "text_1",
        type: "text",
        text: "check these",
        sessionID: "ses_1",
        messageID: "msg_1",
      },
      {
        id: "file_1",
        type: "file",
        mime: "image/png",
        url: "data:image/png;base64,AAA",
        filename: "a.png",
        sessionID: "ses_1",
        messageID: "msg_1",
      },
      {
        id: "file_2",
        type: "file",
        mime: "application/pdf",
        url: "data:application/pdf;base64,BBB",
        filename: "b.pdf",
        sessionID: "ses_1",
        messageID: "msg_1",
      },
    ] satisfies Part[]

    const result = extractPromptFromParts(parts)

    expect(result).toHaveLength(3)
    expect(result[0]).toMatchObject({ type: "text", content: "check these" })
    expect(result.slice(1)).toMatchObject([
      {
        type: "image",
        filename: "a.png",
        mime: "image/png",
        blob: expect.objectContaining({ id: expect.any(String) }),
      },
      {
        type: "image",
        filename: "b.pdf",
        mime: "application/pdf",
        blob: expect.objectContaining({ id: expect.any(String) }),
      },
    ])
  })
})
