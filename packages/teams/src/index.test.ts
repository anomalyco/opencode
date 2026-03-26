import { describe, expect, test } from "bun:test"
import type { SessionPromptResponse, ToolPart } from "@opencode-ai/sdk"
import type { Activity } from "botbuilder"
import { conversationKey, messageText, responseText, toolText } from "./index"

describe("teams helpers", () => {
  test("builds a stable conversation key", () => {
    const activity = {
      conversation: { id: "chat-1" },
      channelData: { tenant: { id: "tenant-1" } },
    } as Partial<Activity>

    expect(conversationKey(activity)).toBe("teams:tenant-1:chat-1")
  })

  test("removes the bot mention from message text", () => {
    const activity = {
      text: "<at>OpenCode</at> hello there",
      recipient: { id: "bot" },
      entities: [{ type: "mention", mentioned: { id: "bot" }, text: "<at>OpenCode</at>" }],
    } as unknown as Partial<Activity>

    expect(messageText(activity)).toBe("hello there")
  })

  test("joins assistant text parts", () => {
    const message = {
      info: {
        id: "m1",
        sessionID: "s1",
        role: "assistant",
        time: { created: 1 },
        parentID: "p1",
        modelID: "model",
        providerID: "provider",
        mode: "chat",
        path: { cwd: "/", root: "/" },
        cost: 0,
        tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      },
      parts: [
        { id: "p1", sessionID: "s1", messageID: "m1", type: "text", text: "Hello" },
        { id: "p2", sessionID: "s1", messageID: "m1", type: "text", text: "World" },
      ],
    } satisfies SessionPromptResponse

    expect(responseText(message)).toBe("Hello\nWorld")
  })

  test("formats completed tool updates", () => {
    const part = {
      id: "t1",
      sessionID: "s1",
      messageID: "m1",
      type: "tool",
      callID: "c1",
      tool: "search",
      state: {
        status: "completed",
        input: {},
        output: "",
        title: "Fetched docs",
        metadata: {},
        time: { start: 1, end: 2 },
      },
    } satisfies ToolPart

    expect(toolText(part)).toBe("*search* - Fetched docs")
  })
})
