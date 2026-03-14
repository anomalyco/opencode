import { expect, test, describe } from "bun:test"
import { MessageV2 } from "../../src/session/message-v2"
import type { Provider } from "../../src/provider/provider"

describe("Question tool with image attachments", () => {
  const model: Provider.Model = {
    id: "test-model",
    providerID: "test-provider",
    api: {
      npm: "@ai-sdk/openai-compatible",
      id: "test-model",
    },
    capabilities: {
      input: {
        image: true,
        pdf: false,
        audio: false,
        video: false,
      },
      output: {
        image: false,
        audio: false,
        video: false,
      },
      reasoning: false,
      tools: true,
      streaming: true,
    },
  }

  const basePart = (messageID: string, partID: string) => ({
    id: partID,
    sessionID: "session-1",
    messageID,
  })

  test("handles question tool with image attachment", () => {
    const userID = "user-1"
    const assistantID = "assistant-1"

    const input: MessageV2.WithParts[] = [
      {
        info: {
          id: userID,
          sessionID: "session-1",
          role: "user",
          time: { created: 0 },
          agent: "build",
          model: { providerID: "test-provider", modelID: "test-model" },
        } as MessageV2.User,
        parts: [
          {
            ...basePart(userID, "text-1"),
            type: "text",
            text: "ask me a question",
          },
        ] as MessageV2.Part[],
      },
      {
        info: {
          id: assistantID,
          sessionID: "session-1",
          role: "assistant",
          time: { created: 1, completed: 2 },
          parentID: userID,
          modelID: "test-model",
          providerID: "test-provider",
          mode: "agentic",
          agent: "build",
          path: { cwd: "/", root: "/" },
          cost: 0,
          tokens: {
            total: 100,
            input: 50,
            output: 50,
            reasoning: 0,
            cache: { read: 0, write: 0 },
          },
        } as MessageV2.Assistant,
        parts: [
          {
            ...basePart(assistantID, "text-1"),
            type: "text",
            text: "I'll ask you a question",
          },
          {
            ...basePart(assistantID, "tool-1"),
            type: "tool",
            callID: "call-1",
            tool: "question",
            state: {
              status: "completed",
              input: {
                questions: [
                  {
                    question: "What is your favorite color?",
                    header: "Color",
                    options: [
                      { label: "Red", description: "The color red" },
                      { label: "Blue", description: "The color blue" },
                    ],
                  },
                ],
              },
              output: 'User has answered your questions: "What is your favorite color?"="Red, [image]"',
              title: "Asked 1 question",
              metadata: {},
              time: { start: 1, end: 2 },
              attachments: [
                {
                  ...basePart(assistantID, "file-1"),
                  type: "file",
                  mime: "image/png",
                  filename: "screenshot.png",
                  url: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
                },
              ],
            },
          },
        ] as MessageV2.Part[],
      },
    ]

    // This should not throw an error
    const result = MessageV2.toModelMessages(input, model)

    // Verify the structure
    expect(result).toBeDefined()
    expect(result.length).toBeGreaterThan(0)

    // Find the user message with the image
    const userMessages = result.filter((msg) => msg.role === "user")
    expect(userMessages.length).toBeGreaterThan(0)

    // Check if the image was properly injected
    const lastUserMessage = userMessages[userMessages.length - 1]
    expect(lastUserMessage.content).toBeDefined()

    // The content should be an array with text and file parts
    if (Array.isArray(lastUserMessage.content)) {
      const fileParts = lastUserMessage.content.filter((part: any) => part.type === "file")
      expect(fileParts.length).toBeGreaterThan(0)

      // Verify the file part has the correct structure
      const filePart = fileParts[0]
      expect(filePart).toHaveProperty("data")
      expect(filePart.data).toContain("data:image/png;base64,")
    }
  })

  test("handles nested data URL in question tool attachment", () => {
    const userID = "user-1"
    const assistantID = "assistant-1"

    // Simulate a nested data URL that might come from the frontend
    const nestedDataUrl = "data:image/png;base64,data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="

    const input: MessageV2.WithParts[] = [
      {
        info: {
          id: userID,
          sessionID: "session-1",
          role: "user",
          time: { created: 0 },
          agent: "build",
          model: { providerID: "test-provider", modelID: "test-model" },
        } as MessageV2.User,
        parts: [
          {
            ...basePart(userID, "text-1"),
            type: "text",
            text: "ask me a question",
          },
        ] as MessageV2.Part[],
      },
      {
        info: {
          id: assistantID,
          sessionID: "session-1",
          role: "assistant",
          time: { created: 1, completed: 2 },
          parentID: userID,
          modelID: "test-model",
          providerID: "test-provider",
          mode: "agentic",
          agent: "build",
          path: { cwd: "/", root: "/" },
          cost: 0,
          tokens: {
            total: 100,
            input: 50,
            output: 50,
            reasoning: 0,
            cache: { read: 0, write: 0 },
          },
        } as MessageV2.Assistant,
        parts: [
          {
            ...basePart(assistantID, "tool-1"),
            type: "tool",
            callID: "call-1",
            tool: "question",
            state: {
              status: "completed",
              input: {
                questions: [
                  {
                    question: "What do you see?",
                    header: "Image",
                    options: [],
                  },
                ],
              },
              output: 'User has answered: "[image]"',
              title: "Asked 1 question",
              metadata: {},
              time: { start: 1, end: 2 },
              attachments: [
                {
                  ...basePart(assistantID, "file-1"),
                  type: "file",
                  mime: "image/png",
                  filename: "pasted.png",
                  url: nestedDataUrl,
                },
              ],
            },
          },
        ] as MessageV2.Part[],
      },
    ]

    // This should not throw an error
    const result = MessageV2.toModelMessages(input, model)

    // Verify the nested data URL was cleaned up
    const userMessages = result.filter((msg) => msg.role === "user")
    const lastUserMessage = userMessages[userMessages.length - 1]

    if (Array.isArray(lastUserMessage.content)) {
      const fileParts = lastUserMessage.content.filter((part: any) => part.type === "file")
      expect(fileParts.length).toBeGreaterThan(0)

      const filePart = fileParts[0]
      expect(filePart.data).toBeDefined()
      expect(filePart.data).toContain("data:image/png;base64,")

      // Verify there's only ONE data URL prefix
      const dataUrlCount = (filePart.data.match(/data:image\/png;base64,/g) || []).length
      expect(dataUrlCount).toBe(1)
    }
  })
})
