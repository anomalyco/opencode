import { describe, expect, test } from "bun:test"
import { convertToOpenAIResponsesInput } from "@/provider/sdk/openai-compatible/src/responses/convert-to-openai-responses-input"
import { MessageV2 } from "@/session/message-v2"
import type { Provider } from "@/provider/provider"
import { ModelID, ProviderID } from "@/provider/schema"
import { MessageID, PartID, SessionID } from "@/session/schema"

const sessionID = SessionID.make("session")

const model: Provider.Model = {
  id: ModelID.make("test-model"),
  providerID: ProviderID.make("test"),
  api: {
    id: "test-model",
    url: "https://example.com",
    npm: "@ai-sdk/openai",
  },
  name: "Test Model",
  capabilities: {
    temperature: true,
    reasoning: false,
    attachment: false,
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
    interleaved: false,
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

function userInfo(id: string): MessageV2.User {
  return {
    id: MessageID.make(id),
    sessionID,
    role: "user",
    time: { created: 0 },
    agent: "user",
    model: { providerID: ProviderID.make("test"), modelID: ModelID.make("test") },
    tools: {},
    mode: "",
  } as unknown as MessageV2.User
}

function assistantInfo(id: string, parentID: string): MessageV2.Assistant {
  return {
    id: MessageID.make(id),
    sessionID,
    role: "assistant",
    time: { created: 0 },
    parentID: MessageID.make(parentID),
    modelID: model.api.id,
    providerID: model.providerID,
    mode: "",
    agent: "agent",
    path: { cwd: "/", root: "/" },
    cost: 0,
    tokens: {
      input: 0,
      output: 0,
      reasoning: 0,
      cache: { read: 0, write: 0 },
    },
  } as unknown as MessageV2.Assistant
}

function basePart(messageID: string, id: string) {
  return {
    id: PartID.make(id),
    sessionID,
    messageID: MessageID.make(messageID),
  }
}

describe("openai-compatible responses tool media", () => {
  test("injects tool result images as a follow-up user input", async () => {
    const result = await convertToOpenAIResponsesInput({
      prompt: [
        {
          role: "tool",
          content: [
            {
              type: "tool-result",
              toolCallId: "call-1",
              toolName: "question",
              output: {
                type: "content",
                value: [
                  { type: "text", text: "User attached an image" },
                  { type: "media", mediaType: "image/png", data: "AAECAw==" },
                ],
              },
            },
          ],
        },
      ] as any,
      systemMessageMode: "system",
      store: false,
    })

    expect(result.input).toEqual([
      {
        type: "function_call_output",
        call_id: "call-1",
        output: "User attached an image",
      },
      {
        role: "user",
        content: [
          { type: "input_text", text: "Attached image(s) from tool result:" },
          { type: "input_image", image_url: "data:image/png;base64,AAECAw==" },
        ],
      },
    ])
  })

  test("reuses tool result data urls without adding another base64 prefix", async () => {
    const result = await convertToOpenAIResponsesInput({
      prompt: [
        {
          role: "tool",
          content: [
            {
              type: "tool-result",
              toolCallId: "call-1",
              toolName: "question",
              output: {
                type: "content",
                value: [
                  { type: "text", text: "User attached an image" },
                  { type: "media", mediaType: "image/png", data: "data:image/png;base64,AAECAw==" },
                ],
              },
            },
          ],
        },
      ] as any,
      systemMessageMode: "system",
      store: false,
    })

    expect(result.input).toEqual([
      {
        type: "function_call_output",
        call_id: "call-1",
        output: "User attached an image",
      },
      {
        role: "user",
        content: [
          { type: "input_text", text: "Attached image(s) from tool result:" },
          { type: "input_image", image_url: "data:image/png;base64,AAECAw==" },
        ],
      },
    ])
  })

  test("normalizes nested tool result data urls", async () => {
    const result = await convertToOpenAIResponsesInput({
      prompt: [
        {
          role: "tool",
          content: [
            {
              type: "tool-result",
              toolCallId: "call-1",
              toolName: "question",
              output: {
                type: "content",
                value: [
                  { type: "text", text: "User attached an image" },
                  {
                    type: "media",
                    mediaType: "image/png",
                    data: "data:image/png;base64,data:image/png;base64,AAECAw==",
                  },
                ],
              },
            },
          ],
        },
      ] as any,
      systemMessageMode: "system",
      store: false,
    })

    expect(result.input).toEqual([
      {
        type: "function_call_output",
        call_id: "call-1",
        output: "User attached an image",
      },
      {
        role: "user",
        content: [
          { type: "input_text", text: "Attached image(s) from tool result:" },
          { type: "input_image", image_url: "data:image/png;base64,AAECAw==" },
        ],
      },
    ])
  })

  test("converts a question tool attachment path into provider image input", async () => {
    const prompt = MessageV2.toModelMessages(
      [
        {
          info: userInfo("m-user"),
          parts: [
            {
              ...basePart("m-user", "u1"),
              type: "text",
              text: "answer the question",
            },
          ] as MessageV2.Part[],
        },
        {
          info: assistantInfo("m-assistant", "m-user"),
          parts: [
            {
              ...basePart("m-assistant", "a1"),
              type: "tool",
              callID: "call-1",
              tool: "question",
              state: {
                status: "completed",
                input: { questions: [{ question: "What do you see?" }] },
                output: 'User has answered your questions: "What do you see?"="Attached, [image: proof.png]".',
                title: "Question",
                metadata: {},
                time: { start: 0, end: 1 },
                attachments: [
                  {
                    ...basePart("m-assistant", "f1"),
                    type: "file",
                    mime: "image/png",
                    filename: "proof.png",
                    url: "data:image/png;base64,AAECAw==",
                  },
                ],
              },
            },
          ] as MessageV2.Part[],
        },
      ],
      model,
    )

    const result = await convertToOpenAIResponsesInput({
      prompt: prompt as any,
      systemMessageMode: "system",
      store: false,
    })

    expect(result.input).toEqual([
      {
        role: "user",
        content: [{ type: "input_text", text: "answer the question" }],
      },
      {
        type: "function_call",
        call_id: "call-1",
        name: "question",
        arguments: JSON.stringify({ questions: [{ question: "What do you see?" }] }),
        id: undefined,
      },
      {
        type: "function_call_output",
        call_id: "call-1",
        output: 'User has answered your questions: "What do you see?"="Attached, [image: proof.png]".',
      },
      {
        role: "user",
        content: [
          { type: "input_text", text: "Attached image(s) from tool result:" },
          { type: "input_image", image_url: "data:image/png;base64,AAECAw==" },
        ],
      },
    ])
  })

  test("reuses data urls from direct user image input", async () => {
    const result = await convertToOpenAIResponsesInput({
      prompt: [
        {
          role: "user",
          content: [
            { type: "text", text: "look at this" },
            {
              type: "file",
              data: "data:image/png;base64,AAECAw==",
              mediaType: "image/png",
            },
          ],
        },
      ] as any,
      systemMessageMode: "system",
      store: false,
    })

    expect(result.input).toEqual([
      {
        role: "user",
        content: [
          { type: "input_text", text: "look at this" },
          { type: "input_image", image_url: "data:image/png;base64,AAECAw==" },
        ],
      },
    ])
  })
})
