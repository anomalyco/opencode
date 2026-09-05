import { describe, expect, test } from "bun:test"
import type { Part } from "@opencode-ai/sdk/v2"
import { extractPromptFromParts } from "./prompt"

describe("extractPromptFromParts", () => {
  test("restores the resolved path for a reference alias", () => {
    const parts = [
      {
        id: "text_1",
        type: "text",
        text: "check @docs",
        sessionID: "ses_1",
        messageID: "msg_1",
      },
      {
        id: "file_1",
        type: "file",
        mime: "text/plain",
        url: "file:///shared/company-docs",
        filename: "docs",
        sessionID: "ses_1",
        messageID: "msg_1",
        source: {
          type: "file",
          path: "/shared/company-docs",
          text: {
            value: "@docs",
            start: 6,
            end: 11,
          },
        },
      },
    ] satisfies Part[]

    expect(extractPromptFromParts(parts, { directory: "/repo" })).toMatchObject([
      { type: "text", content: "check " },
      { type: "file", path: "/shared/company-docs", content: "@docs" },
    ])
  })

  test("normalizes a restored Windows reference path inside the session directory", () => {
    const parts = [
      {
        id: "text_1",
        type: "text",
        text: "@docs",
        sessionID: "ses_1",
        messageID: "msg_1",
      },
      {
        id: "file_1",
        type: "file",
        mime: "text/plain",
        url: "file:///C:/repo/shared/docs",
        filename: "docs",
        sessionID: "ses_1",
        messageID: "msg_1",
        source: {
          type: "file",
          path: "C:\\repo\\shared\\docs",
          text: {
            value: "@docs",
            start: 0,
            end: 5,
          },
        },
      },
    ] satisfies Part[]

    expect(extractPromptFromParts(parts, { directory: "C:\\repo" })).toMatchObject([
      { type: "file", path: "shared/docs", content: "@docs" },
    ])
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
