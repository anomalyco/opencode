import { describe, expect, test } from "bun:test"
import { Message, ToolResultPart } from "@opencode-ai/ai"
import { boundImages, toolResultMediaFallback, unsupportedParts } from "@opencode-ai/core/session/model-request"

const capabilities = (input: string[]) => ({ tools: true, input, output: ["text"] })

describe("SessionModelRequest.unsupportedParts", () => {
  test("replaces unsupported user media with a visible error", () => {
    const messages = unsupportedParts(
      [
        Message.user([
          Message.text("Describe this image"),
          { type: "media", mediaType: "image/png", data: "aGVsbG8=", filename: "logo.png" },
        ]),
      ],
      capabilities(["text"]),
    )

    expect(messages[0]?.content).toEqual([
      Message.text("Describe this image"),
      Message.text('ERROR: Cannot read "logo.png" (this model does not support image input). Inform the user.'),
    ])
  })

  test("replaces unsupported media nested in tool results", () => {
    const messages = unsupportedParts(
      [
        Message.tool(
          ToolResultPart.make({
            id: "call_1",
            name: "read",
            result: {
              type: "content",
              value: [
                { type: "text", text: "Image read successfully" },
                { type: "file", uri: "data:image/png;base64,aGVsbG8=", mime: "image/png", name: "logo.png" },
              ],
            },
          }),
        ),
      ],
      capabilities(["text"]),
    )

    expect(messages[0]?.content[0]).toMatchObject({
      type: "tool-result",
      result: {
        type: "content",
        value: [
          { type: "text", text: "Image read successfully" },
          {
            type: "text",
            text: 'ERROR: Cannot read "logo.png" (this model does not support image input). Inform the user.',
          },
        ],
      },
    })
  })

  test("preserves supported media", () => {
    const message = Message.user({ type: "media", mediaType: "image/png", data: "aGVsbG8=" })
    expect(unsupportedParts([message], capabilities(["text", "image"]))[0]?.content).toEqual(message.content)
  })
})

describe("SessionModelRequest.boundImages", () => {
  test("preserves images below the trigger", () => {
    const messages = [Message.user({ type: "media", mediaType: "image/png", data: "aGVsbG8=" })]
    expect(boundImages(messages)).toBe(messages)
  })

  test("replaces oldest images until the retained payload reaches the target", () => {
    const image = "a".repeat(9 * 1024 * 1024)
    const messages = [
      Message.user({ type: "media", mediaType: "image/png", data: image, filename: "first.png" }),
      Message.user({ type: "media", mediaType: "image/png", data: image, filename: "second.png" }),
      Message.user({ type: "media", mediaType: "image/png", data: image, filename: "third.png" }),
    ]
    const result = boundImages(messages)

    expect(result[0]?.content[0]).toMatchObject({ type: "text" })
    expect(result[1]?.content[0]).toMatchObject({ type: "text" })
    expect(result[2]?.content[0]).toMatchObject({ type: "media", filename: "third.png" })
  })

  test("replaces images nested in tool results", () => {
    const image = "a".repeat(13 * 1024 * 1024)
    const result = boundImages([
      Message.tool(
        ToolResultPart.make({
          id: "call_1",
          name: "read",
          result: {
            type: "content",
            value: [
              { type: "file", uri: `data:image/png;base64,${image}`, mime: "image/png", name: "first.png" },
              { type: "file", uri: `data:image/png;base64,${image}`, mime: "image/png", name: "second.png" },
            ],
          },
        }),
      ),
    ])

    expect(result[0]?.content[0]).toMatchObject({
      type: "tool-result",
      result: {
        type: "content",
        value: [{ type: "text" }, { type: "file", name: "second.png" }],
      },
    })
  })
})

describe("SessionModelRequest.toolResultMediaFallback", () => {
  test("moves image and PDF tool results into a following user message", () => {
    const messages = toolResultMediaFallback(
      [
        Message.tool(
          ToolResultPart.make({
            id: "call_1",
            name: "read",
            result: {
              type: "content",
              value: [
                { type: "text", text: "Attachments read successfully" },
                { type: "file", uri: "data:image/png;base64,AAAA", mime: "image/png", name: "pixel.png" },
                {
                  type: "file",
                  uri: "data:application/pdf;base64,JVBERg==",
                  mime: "application/pdf",
                  name: "document.pdf",
                },
                { type: "file", uri: "data:audio/mpeg;base64,SUQz", mime: "audio/mpeg", name: "clip.mp3" },
              ],
            },
          }),
        ),
      ],
      "ai-sdk",
    )

    expect(messages).toEqual([
      Message.tool(
        ToolResultPart.make({
          id: "call_1",
          name: "read",
          result: {
            type: "content",
            value: [
              { type: "text", text: "Attachments read successfully" },
              { type: "file", uri: "data:audio/mpeg;base64,SUQz", mime: "audio/mpeg", name: "clip.mp3" },
            ],
          },
        }),
      ),
      Message.user([
        Message.text("Attached media from tool result:"),
        { type: "media", mediaType: "image/png", data: "AAAA", filename: "pixel.png" },
        { type: "media", mediaType: "application/pdf", data: "JVBERg==", filename: "document.pdf" },
      ]),
    ])
  })

  test("leaves a valid tool result when all content is moved", () => {
    const messages = toolResultMediaFallback(
      [
        Message.tool(
          ToolResultPart.make({
            id: "call_1",
            name: "screenshot",
            result: {
              type: "content",
              value: [{ type: "file", uri: "data:image/png;base64,AAAA", mime: "image/png" }],
            },
          }),
        ),
      ],
      "ai-sdk",
    )

    expect(messages[0]?.content[0]).toMatchObject({
      type: "tool-result",
      result: { type: "text", value: "Media attached in the following user message." },
    })
    expect(messages[1]?.role).toBe("user")
  })

  test("leaves native protocol tool results untouched", () => {
    const messages = [
      Message.tool(
        ToolResultPart.make({
          id: "call_1",
          name: "screenshot",
          result: {
            type: "content",
            value: [{ type: "file", uri: "data:image/png;base64,AAAA", mime: "image/png" }],
          },
        }),
      ),
    ]

    expect(toolResultMediaFallback(messages, "openai-chat")).toBe(messages)
  })
})
