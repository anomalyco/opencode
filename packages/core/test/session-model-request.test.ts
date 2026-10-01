import { describe, expect, test } from "bun:test"
import { Message, ToolResultPart, Media } from "@opencode/ai"
import { boundImages, unsupportedParts } from "@opencode/core/session/model-request"

const capabilities = (input: string[]) => ({ tools: true, input, output: ["text"] })

describe("SessionModelRequest.unsupportedParts", () => {
  test("replaces unsupported user media with a visible error", () => {
    const messages = unsupportedParts(
      [
        Message.user([
          Message.text("Describe these files"),
          { type: "media", media: Media.base64("aGVsbG8=", "image/png"), filename: "logo.png" },
          { type: "media", media: Media.base64("JVBERg==", "application/pdf"), filename: "document.pdf" },
        ]),
      ],
      capabilities(["text"]),
    )

    expect(messages[0]?.content).toEqual([
      Message.text("Describe these files"),
      Message.text('ERROR: Cannot read "logo.png" (this model does not support image input). Inform the user.'),
      Message.text('ERROR: Cannot read "document.pdf" (this model does not support pdf input). Inform the user.'),
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
    const message = Message.user({ type: "media", media: Media.base64("aGVsbG8=", "image/png") })
    expect(unsupportedParts([message], capabilities(["text", "image"]))[0]?.content).toEqual(message.content)
  })
})

describe("SessionModelRequest.boundImages", () => {
  test("preserves images below the trigger", () => {
    const messages = [Message.user({ type: "media", media: Media.base64("aGVsbG8=", "image/png") })]
    expect(boundImages(messages)).toBe(messages)
  })

  test("replaces oldest images until the retained payload reaches the target", () => {
    const image = "a".repeat(9 * 1024 * 1024)
    const messages = [
      Message.user({ type: "media", media: Media.base64(image, "image/png"), filename: "first.png" }),
      Message.user({ type: "media", media: Media.base64(image, "image/png"), filename: "second.png" }),
      Message.user({ type: "media", media: Media.base64(image, "image/png"), filename: "third.png" }),
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

  test("degrades tool results whose content value is not an array", () => {
    // Malformed history (e.g. produced by an older build, a plugin hook, or a
    // provider round-trip) must not crash SessionModelRequest.prepare — the
    // whole session drain dies otherwise.
    const malformed = {
      type: "tool-result",
      id: "call_1",
      name: "read",
      result: { type: "content", value: undefined },
    }
    // Plain object on purpose: the runtime path that produces these parts
    // bypasses schema validation.
    const messages = [{ id: "msg_1", role: "user", content: [malformed] } as never]

    const replaced = {
      type: "text",
      value: "ERROR: Tool result was malformed and could not be included in the request.",
    }
    expect(unsupportedParts(messages, capabilities(["text"]))[0]?.content[0]).toMatchObject({
      type: "tool-result",
      result: replaced,
    })
    // boundImages early-returns below the image-byte trigger, but its size
    // reduce still walks every tool result — that path must not throw either.
    expect(() => boundImages(messages)).not.toThrow()
  })

  test("boundImages degrades malformed tool results while trimming images", () => {
    const big = `data:image/png;base64,${"a".repeat(26 * 1024 * 1024)}`
    const malformed = {
      type: "tool-result",
      id: "call_1",
      name: "read",
      result: { type: "content", value: undefined },
    }
    const withImage = {
      type: "tool-result",
      id: "call_2",
      name: "read",
      result: {
        type: "content",
        value: [{ type: "file", uri: big, mime: "image/png", name: "big.png" }],
      },
    }
    const messages = [{ id: "msg_1", role: "user", content: [malformed, withImage] } as never]

    const out = boundImages(messages)
    expect(out[0]?.content[0]).toMatchObject({
      type: "tool-result",
      result: { type: "text", value: "ERROR: Tool result was malformed and could not be included in the request." },
    })
    // the oversized image is replaced per the normal trimming rules
    expect(out[0]?.content[1]).toMatchObject({ type: "tool-result" })
  })
})
