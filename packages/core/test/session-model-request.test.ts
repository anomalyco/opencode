import { describe, expect, test } from "bun:test"
import { Message, ToolResultPart, Media } from "@opencode/ai"
import { boundImages, outputLimit, unsupportedParts } from "@opencode/core/session/model-request"

const capabilities = (input: string[]) => ({ tools: true, input, output: ["text"] })

describe("SessionModelRequest.outputLimit", () => {
  test("requests the catalog output limit up to the cap", () => {
    expect(outputLimit({ context: 1_000_000, output: 128_000 }, 256_000)).toBe(128_000)
    expect(outputLimit({ context: 200_000, output: 64_000 }, 256_000)).toBe(64_000)
    expect(outputLimit({ context: 1_048_576, output: 1_048_576 }, 256_000)).toBe(256_000)
    expect(outputLimit({ context: 200_000, output: 64_000 }, 32_000)).toBe(32_000)
  })

  test("falls back to 32k when the catalog has no output limit", () => {
    expect(outputLimit({ context: 200_000, output: 0 }, 256_000)).toBe(32_000)
  })

  test("fits the limit to the room the prompt leaves in the context window", () => {
    const limit = { context: 1_000_000, output: 128_000 }
    expect(outputLimit(limit, 256_000, { measured: 50_000, estimated: 0 })).toBe(128_000)
    expect(outputLimit(limit, 256_000, { measured: 900_000, estimated: 0 })).toBe(100_000)
    // Estimated text counts 15% extra, so 40k estimated takes 46k of the room.
    expect(outputLimit(limit, 256_000, { measured: 900_000, estimated: 40_000 })).toBe(54_000)
  })

  test("keeps a minimum limit when the prompt nearly fills the context window", () => {
    const prompt = { measured: 199_000, estimated: 0 }
    expect(outputLimit({ context: 200_000, output: 64_000 }, 256_000, prompt)).toBe(1_024)
    expect(outputLimit({ context: 200_000, output: 512 }, 256_000, prompt)).toBe(512)
  })

  test("ignores the prompt size when the context window is unknown", () => {
    expect(outputLimit({ context: 0, output: 32_000 }, 256_000, { measured: 500_000, estimated: 0 })).toBe(32_000)
  })
})

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
})
