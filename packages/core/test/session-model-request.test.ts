import { describe, expect, test } from "bun:test"
import { Message, ToolMessage, ToolResultPart, Media, UserMessage } from "@opencode/ai/effect"
import { boundImages, boundVideos, unsupportedParts } from "@opencode/core/session/model-request"

const capabilities = (input: string[]) => ({ tools: true, input, output: ["text"] })

describe("SessionModelRequest.unsupportedParts", () => {
  test("replaces unsupported user media with a visible error", () => {
    const messages = unsupportedParts(
      [
        Message.user([
          Message.text("Describe these files"),
          { type: "media", media: Media.base64("aGVsbG8=", "image/png"), filename: "logo.png" },
          { type: "media", media: Media.base64("JVBERg==", "application/pdf"), filename: "document.pdf" },
          { type: "media", media: Media.base64("AAAAGGZ0eXBtcDQy", "video/mp4"), filename: "clip.mp4" },
        ]),
      ],
      capabilities(["text"]),
    )

    expect(messages[0]?.content).toEqual([
      Message.text("Describe these files"),
      Message.text('ERROR: Cannot read "logo.png" (this model does not support image input). Inform the user.'),
      Message.text('ERROR: Cannot read "document.pdf" (this model does not support pdf input). Inform the user.'),
      Message.text('ERROR: Cannot read "clip.mp4" (this model does not support video input). Inform the user.'),
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

  test("replaces images xAI cannot decode and keeps png, jpeg and webp", () => {
    const image = (mime: string, name: string) => ({
      type: "media" as const,
      media: Media.base64("aGVsbG8=", mime),
      filename: name,
    })
    const user = [image("image/png", "a.png"), image("image/jpeg", "b.jpg"), image("image/webp", "c.webp")]
    const messages = [
      Message.user([...user, image("image/gif", "d.gif")]),
      Message.tool(
        ToolResultPart.make({
          id: "call_1",
          name: "read",
          result: {
            type: "content",
            value: [
              { type: "text", text: "Image read successfully" },
              { type: "file", uri: "data:image/gif;base64,R0lGODlh", mime: "image/gif", name: "e.gif" },
            ],
          },
        }),
      ),
    ]
    const result = unsupportedParts(messages, capabilities(["text", "image"]), "xai")

    expect(result[0]?.content).toEqual([
      ...user,
      Message.text('ERROR: Cannot read "d.gif" (this model does not support image/gif input). Inform the user.'),
    ])
    expect(result[1]?.content[0]).toMatchObject({
      type: "tool-result",
      result: {
        type: "content",
        value: [
          { type: "text", text: "Image read successfully" },
          {
            type: "text",
            text: 'ERROR: Cannot read "e.gif" (this model does not support image/gif input). Inform the user.',
          },
        ],
      },
    })
    expect(unsupportedParts(messages, capabilities(["text", "image"]), "openai")).toEqual(messages)
  })

  test("preserves supported media", () => {
    const message = Message.user({ type: "media", media: Media.base64("aGVsbG8=", "image/png") })
    expect(unsupportedParts([message], capabilities(["text", "image"]))[0]?.content).toEqual(message.content)
  })

  test("returns the same messages when nothing is unsupported", () => {
    const messages = [
      Message.user([Message.text("hi"), { type: "media", media: Media.base64("aGVsbG8=", "image/png") }]),
      Message.assistant("hello"),
      Message.tool(
        ToolResultPart.make({
          id: "call_1",
          name: "read",
          result: {
            type: "content",
            value: [{ type: "file", uri: "data:image/png;base64,aGVsbG8=", mime: "image/png", name: "logo.png" }],
          },
        }),
      ),
    ]
    const result = unsupportedParts(messages, capabilities(["text", "image"]))
    expect(result).toHaveLength(messages.length)
    result.forEach((message, index) => expect(message).toBe(messages[index]))
  })

  test("rebuilds only messages with unsupported media", () => {
    const text = Message.user("plain")
    const supported = Message.tool(
      ToolResultPart.make({
        id: "call_1",
        name: "read",
        result: { type: "content", value: [{ type: "text", text: "no files" }] },
      }),
    )
    const tool = ToolResultPart.make({
      id: "call_2",
      name: "read",
      result: {
        type: "content",
        value: [
          { type: "text", text: "Read" },
          { type: "file", uri: "data:application/pdf;base64,JVBERg==", mime: "application/pdf" },
        ],
      },
    })
    const untouched = ToolResultPart.make({ id: "call_3", name: "read", result: "done" })
    const unsupported = Message.make({ role: "tool", content: [tool, untouched] })
    const result = unsupportedParts([text, supported, unsupported], capabilities(["text"]))

    expect(result[0]).toBe(text)
    expect(result[1]).toBe(supported)
    expect(result[2]).not.toBe(unsupported)
    expect(result[2]).toBeInstanceOf(ToolMessage)
    expect(result[2]?.content[1]).toEqual(untouched)
    expect(result[2]?.content[0]).toMatchObject({
      type: "tool-result",
      result: {
        type: "content",
        value: [
          { type: "text", text: "Read" },
          { type: "text", text: "ERROR: Cannot read pdf (this model does not support pdf input). Inform the user." },
        ],
      },
    })
    expect(tool.result).toMatchObject({
      type: "content",
      value: [
        { type: "text", text: "Read" },
        { type: "file", mime: "application/pdf" },
      ],
    })
  })
})

describe("SessionModelRequest.boundImages", () => {
  test("preserves images below the trigger", () => {
    const messages = [Message.user({ type: "media", media: Media.base64("aGVsbG8=", "image/png") })]
    expect(boundImages(messages)).toBe(messages)
  })

  test("replaces oldest images until the retained payload reaches the target", () => {
    const image = "a".repeat(9 * 1024 * 1024)
    const text = Message.user("plain")
    const third = Message.user({ type: "media", media: Media.base64(image, "image/png"), filename: "third.png" })
    const messages = [
      Message.user({ type: "media", media: Media.base64(image, "image/png"), filename: "first.png" }),
      text,
      Message.user({ type: "media", media: Media.base64(image, "image/png"), filename: "second.png" }),
      third,
    ]
    const result = boundImages(messages)

    expect(result[0]).toBeInstanceOf(UserMessage)
    expect(result[0]?.content).toEqual([Message.text(expect.stringContaining("image was removed"))])
    expect(result[1]).toBe(text)
    expect(result[2]).not.toBe(messages[2])
    expect(result[2]?.content[0]).toMatchObject({ type: "text" })
    expect(result[3]).toBe(third)
  })

  test("keeps the replaced prefix stable as new images arrive, so the prompt cache survives", () => {
    const image = (name: string) =>
      Message.user({ type: "media", media: Media.base64("a".repeat(3 * 1024 * 1024), "image/png"), filename: name })
    const removed = (messages: ReturnType<typeof boundImages>) =>
      messages.filter((message) => message.content[0]?.type === "text").length
    const history = Array.from({ length: 9 }, (_, i) => image(`${i}.png`))

    // 27 MiB passes the 25 MiB trigger: the oldest four go, leaving 15 MiB.
    expect(removed(boundImages(history))).toBe(4)
    // Each later image used to move the cut by one; now the cut holds until the kept payload passes the trigger again.
    expect(removed(boundImages([...history, image("9.png")]))).toBe(4)
    expect(removed(boundImages([...history, image("9.png"), image("10.png"), image("11.png")]))).toBe(4)
    expect(removed(boundImages([...history, ...Array.from({ length: 4 }, (_, i) => image(`${9 + i}.png`))]))).toBe(8)
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

describe("SessionModelRequest.boundVideos", () => {
  const video = (size = 16) => ({ type: "media" as const, media: Media.base64("a".repeat(size), "video/mp4") })
  const image = { type: "media" as const, media: Media.base64("aGVsbG8=", "image/png") }
  const removed = Message.text(expect.stringContaining("video was removed"))
  const tooLarge = Message.text(expect.stringContaining("shorter or smaller clip"))
  const cap = 18 * 1024 * 1024

  // Each word is a message: v is a video, c one at the inline cap, V one over it, i an image, r and t replacements.
  const parts = { v: video(), c: video(cap), V: video(cap + 4), i: image, r: removed, t: tooLarge }
  const request = (words: string) =>
    words.split(" ").map((word) => [...word].map((key) => parts[key as keyof typeof parts]))
  test.each([
    ["keeps a lone video at the inline cap", "ci", "ci"],
    ["replaces a lone video over the inline cap", "V", "t"],
    ["keeps only the newest video", "vi vv", "ri rv"],
    ["replaces an old video and a newest over the cap", "v V", "r t"],
  ])("%s", (_, input, output) => {
    const result = boundVideos(request(input).map((content) => Message.user(content)))
    expect<readonly unknown[]>(result.map((message) => message.content)).toEqual(request(output))
  })

  test("counts tool result videos, returns unchanged requests, and leaves the image budget alone", () => {
    const tool = Message.tool(
      ToolResultPart.make({
        id: "call_1",
        name: "read",
        result: { type: "content", value: [{ type: "file", uri: "data:video/mp4;base64,AAAA", mime: "video/mp4" }] },
      }),
    )
    expect(boundVideos([tool, Message.user([video()])])[0]?.content[0]).toMatchObject({
      result: { value: [{ type: "text", text: expect.stringContaining("video was removed") }] },
    })
    const unchanged = [tool, Message.user([image])]
    expect(boundVideos(unchanged)).toBe(unchanged)
    const large = [Message.user([video(13 * 1024 * 1024)]), Message.user([video(13 * 1024 * 1024)])]
    expect(boundImages(large)).toBe(large)
  })
})
