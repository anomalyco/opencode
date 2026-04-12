import { describe, expect, test } from "bun:test"
import { convertToOpenAIResponsesInput } from "../../src/provider/sdk/copilot/responses/convert-to-openai-responses-input"

describe("convertToOpenAIResponsesInput", () => {
  test("emits reasoning before an assistant message when replay order arrives reversed", async () => {
    const result = await convertToOpenAIResponsesInput({
      prompt: [
        {
          role: "assistant",
          content: [
            {
              type: "text",
              text: "Hello",
              providerOptions: {
                openai: {
                  itemId: "msg_123",
                },
              },
            },
            {
              type: "reasoning",
              text: "thinking",
              providerOptions: {
                copilot: {
                  itemId: "rs_123",
                  reasoningEncryptedContent: "encrypted",
                },
              },
            },
          ],
        },
      ] as any,
      systemMessageMode: "system",
      store: false,
    })

    expect(result.input).toMatchObject([
      {
        type: "reasoning",
        id: "rs_123",
        encrypted_content: "encrypted",
        summary: [{ type: "summary_text", text: "thinking" }],
      },
      {
        role: "assistant",
        id: "msg_123",
        content: [{ type: "output_text", text: "Hello" }],
      },
    ])
  })

  test("emits reasoning before a function call when replay order arrives reversed", async () => {
    const result = await convertToOpenAIResponsesInput({
      prompt: [
        {
          role: "assistant",
          content: [
            {
              type: "tool-call",
              toolCallId: "call_123",
              toolName: "read_file",
              input: { filePath: "/README.md" },
              providerExecuted: false,
              providerOptions: {
                openai: {
                  itemId: "fc_123",
                },
              },
            },
            {
              type: "reasoning",
              text: "thinking",
              providerOptions: {
                copilot: {
                  itemId: "rs_456",
                  reasoningEncryptedContent: "encrypted",
                },
              },
            },
          ],
        },
      ] as any,
      systemMessageMode: "system",
      store: false,
    })

    expect(result.input).toMatchObject([
      {
        type: "reasoning",
        id: "rs_456",
        encrypted_content: "encrypted",
        summary: [{ type: "summary_text", text: "thinking" }],
      },
      {
        type: "function_call",
        id: "fc_123",
        call_id: "call_123",
        name: "read_file",
        arguments: '{"filePath":"/README.md"}',
      },
    ])
  })
})