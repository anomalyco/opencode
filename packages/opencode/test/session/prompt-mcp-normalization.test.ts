import { describe, expect, test } from "bun:test"
import { SessionPrompt } from "../../src/session/prompt"
import type { Provider } from "../../src/provider/provider"

const kimiModel: Provider.Model = {
  id: "moonshotai/kimi-k2.5",
  providerID: "moonshotai",
  api: {
    id: "kimi-k2.5",
    url: "https://api.moonshot.ai/v1",
    npm: "@ai-sdk/openai-compatible",
  },
  name: "Kimi K2.5",
  capabilities: {
    temperature: false,
    reasoning: true,
    attachment: true,
    toolcall: true,
    input: {
      text: true,
      audio: false,
      image: true,
      video: false,
      pdf: false,
    },
    output: {
      text: true,
      audio: false,
      image: false,
      video: false,
      pdf: false,
    },
    interleaved: {
      field: "reasoning_content",
    },
  },
  cost: {
    input: 0,
    output: 0,
    cache: {
      read: 0,
      write: 0,
    },
  },
  limit: {
    context: 0,
    input: 0,
    output: 0,
  },
  status: "active",
  options: {},
  headers: {},
  release_date: "2026-01-01",
}

describe("session.prompt mcp normalization", () => {
  test("normalizes figma image content when text is empty", () => {
    const normalized = SessionPrompt.normalizeMcpResultContent({
      sessionID: "session",
      messageID: "message",
      content: [
        {
          type: "text",
          text: "",
        },
        {
          type: "image",
          mimeType: "image/png",
          data: "Zm9v",
        },
      ],
    })

    expect(normalized.text).toStrictEqual([""])
    expect(normalized.attachments).toHaveLength(1)
    expect(normalized.attachments[0]).toMatchObject({
      type: "file",
      mime: "image/png",
      url: "data:image/png;base64,Zm9v",
    })

    const output = SessionPrompt.normalizeMcpOutput({
      model: kimiModel,
      output: "",
      attachments: normalized.attachments,
    })
    expect(output).toBe("[Tool produced non-text output; attachment included separately.]")
  })

  test("normalizes resource blob payloads with empty text", () => {
    const normalized = SessionPrompt.normalizeMcpResultContent({
      sessionID: "session",
      messageID: "message",
      content: [
        {
          type: "resource",
          resource: {
            uri: "figma://node/1:2",
            mimeType: "image/png",
            blob: "YmFy",
          },
        },
      ],
    })

    expect(normalized.text).toStrictEqual([])
    expect(normalized.attachments).toHaveLength(1)
    expect(normalized.attachments[0]).toMatchObject({
      type: "file",
      mime: "image/png",
      filename: "figma://node/1:2",
      url: "data:image/png;base64,YmFy",
    })

    const output = SessionPrompt.normalizeMcpOutput({
      model: kimiModel,
      output: "",
      attachments: normalized.attachments,
    })
    expect(output).toBe("[Tool produced non-text output; attachment included separately.]")
  })

  test("uses non-empty fallback text for empty tool errors", () => {
    const output = SessionPrompt.normalizeMcpOutput({
      model: kimiModel,
      output: "",
      attachments: [],
      isError: true,
    })

    expect(output).toBe("[Tool execution failed without details.]")
  })
})
