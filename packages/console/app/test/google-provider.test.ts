import { describe, expect, test } from "bun:test"
import {
  fromGoogleRequest,
  fromGoogleResponse,
  toGoogleRequest,
  fromGoogleChunk,
} from "../src/routes/zen/util/provider/google"
import { createResponseConverter } from "../src/routes/zen/util/provider/provider"

describe("google provider conversions", () => {
  test("fromGoogleResponse converts inlineData image to markdown image data URL", () => {
    const response = {
      candidates: [
        {
          content: {
            role: "model",
            parts: [
              { text: "cat" },
              {
                inlineData: {
                  mimeType: "image/jpeg",
                  data: "AAA",
                },
              },
            ],
          },
          finishReason: "STOP",
          index: 0,
        },
      ],
      modelVersion: "gemini-3-pro-image",
      responseId: "resp_1",
      usageMetadata: {
        promptTokenCount: 10,
        candidatesTokenCount: 20,
        totalTokenCount: 30,
      },
    }

    const converted = fromGoogleResponse(response)
    expect(converted.choices[0]?.message?.content).toContain("cat")
    expect(converted.choices[0]?.message?.content).toContain("![generated image](data:image/jpeg;base64,AAA)")
    expect(converted.choices[0]?.finish_reason).toBe("stop")
  })

  test("fromGoogleRequest converts inlineData in user parts to image_url", () => {
    const request = {
      contents: [
        {
          role: "user",
          parts: [
            { text: "draw a cat" },
            {
              inlineData: {
                mimeType: "image/png",
                data: "BBB",
              },
            },
          ],
        },
      ],
    }

    const converted = fromGoogleRequest(request)
    expect(Array.isArray(converted.messages)).toBe(true)
    const user = converted.messages[0]
    expect(user?.role).toBe("user")
    expect(Array.isArray(user?.content)).toBe(true)
    if (!Array.isArray(user?.content)) throw new Error("expected array content")
    const image = user.content.find((part) => part.type === "image_url")
    expect(image?.image_url?.url).toBe("data:image/png;base64,BBB")
  })

  test("toGoogleRequest converts image_url data URL to inlineData", () => {
    const request = {
      model: "gemini-3-pro-image",
      messages: [
        {
          role: "user" as const,
          content: [
            { type: "text" as const, text: "hello" },
            { type: "image_url" as const, image_url: { url: "data:image/jpeg;base64,CCC" } },
          ],
        },
      ],
    }

    const converted = toGoogleRequest(request as any)
    const parts = converted.contents?.[0]?.parts ?? []
    const image = parts.find((part: any) => !!part.inlineData)
    expect(image?.inlineData?.mimeType).toBe("image/jpeg")
    expect(image?.inlineData?.data).toBe("CCC")
  })

  test("createResponseConverter handles google non-stream image response", () => {
    const convert = createResponseConverter("google", "oa-compat")
    const converted = convert({
      candidates: [
        {
          content: {
            role: "model",
            parts: [
              { text: "done" },
              {
                inlineData: {
                  mimeType: "image/webp",
                  data: "DDD",
                },
              },
            ],
          },
          finishReason: "STOP",
          index: 0,
        },
      ],
      modelVersion: "gemini-3-pro-image",
      responseId: "resp_2",
    })

    expect(converted.object).toBe("chat.completion")
    expect(converted.choices[0]?.message?.content).toContain("![generated image](data:image/webp;base64,DDD)")
  })

  test("fromGoogleChunk emits content delta with inlineData image markdown", () => {
    const chunk = `data: ${JSON.stringify({
      candidates: [
        {
          content: {
            role: "model",
            parts: [{ text: "x" }, { inlineData: { mimeType: "image/png", data: "EEE" } }],
          },
          finishReason: "STOP",
          index: 0,
        },
      ],
      modelVersion: "gemini-3-pro-image",
      responseId: "resp_3",
    })}`

    const converted = fromGoogleChunk(chunk)
    if (typeof converted === "string") throw new Error("expected converted chunk object")
    expect(converted.choices[0]?.delta?.content).toContain("![generated image](data:image/png;base64,EEE)")
  })
})
