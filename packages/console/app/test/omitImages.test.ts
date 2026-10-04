import { describe, expect, test } from "bun:test"
import { omitImages } from "../src/routes/zen/util/provider/provider"

const note = "[Image omitted: this model does not accept image input]"

describe("omitImages", () => {
  test("replaces anthropic image blocks, including inside tool results", () => {
    const body = omitImages({
      model: "deepseek-v4-flash",
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "what is this?" },
            { type: "image", source: { type: "base64", media_type: "image/png", data: "AAAA" } },
            {
              type: "tool_result",
              tool_use_id: "t1",
              content: [{ type: "image", source: { type: "url", url: "https://example.com/a.png" } }],
            },
          ],
        },
      ],
    })

    expect(body.messages).toEqual([
      {
        role: "user",
        content: [
          { type: "text", text: "what is this?" },
          { type: "text", text: note },
          { type: "tool_result", tool_use_id: "t1", content: [{ type: "text", text: note }] },
        ],
      },
    ])
  })

  test("replaces oa-compat and responses image parts", () => {
    expect(
      omitImages({ messages: [{ role: "user", content: [{ type: "image_url", image_url: { url: "data:x" } }] }] })
        .messages,
    ).toEqual([{ role: "user", content: [{ type: "text", text: note }] }])
    expect(
      omitImages({ input: [{ role: "user", content: [{ type: "input_image", image_url: "data:x" }] }] }).input,
    ).toEqual([{ role: "user", content: [{ type: "input_text", text: note }] }])
  })

  test("leaves tools and other fields untouched", () => {
    const tools = [{ name: "shot", input_schema: { type: "object", properties: { type: { const: "image" } } } }]
    expect(omitImages({ model: "m", tools, stream: true })).toEqual({ model: "m", tools, stream: true })
  })
})
