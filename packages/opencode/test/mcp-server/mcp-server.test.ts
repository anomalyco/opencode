import { describe, expect, test } from "bun:test"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"
import { formatMessages, formatParts, McpServerAgent } from "../../src/mcp-server/agent"
import type { AssistantMessage, Part, ToolPart, UserMessage } from "@opencode-ai/sdk/v2"

function firstText(content: unknown): string {
  const item = (content as Array<{ type: string; text?: string }>)[0]
  if (!item || item.type !== "text" || typeof item.text !== "string") throw new Error("Expected text content")
  return item.text
}

describe("formatParts", () => {
  test("formats a text part with the given role", () => {
    const part: Part = {
      id: "prt_1",
      sessionID: "ses_1",
      messageID: "msg_1",
      type: "text",
      text: "hello world",
    }
    expect(formatParts("User", [part])).toEqual(["[User] hello world"])
  })

  test("skips blank text parts", () => {
    const part: Part = {
      id: "prt_1",
      sessionID: "ses_1",
      messageID: "msg_1",
      type: "text",
      text: "   ",
    }
    expect(formatParts("User", [part])).toEqual([])
  })

  test("formats a completed tool part with its output", () => {
    const part: ToolPart = {
      id: "prt_2",
      sessionID: "ses_1",
      messageID: "msg_1",
      type: "tool",
      callID: "call_1",
      tool: "bash",
      state: {
        status: "completed",
        input: { command: "ls" },
        output: "file.txt\n",
        title: "ls",
        metadata: {},
        time: { start: 0, end: 1 },
      },
    }
    expect(formatParts("Assistant", [part])).toEqual(["[Tool bash] file.txt"])
  })

  test("formats an errored tool part with its error message", () => {
    const part: ToolPart = {
      id: "prt_3",
      sessionID: "ses_1",
      messageID: "msg_1",
      type: "tool",
      callID: "call_1",
      tool: "bash",
      state: {
        status: "error",
        input: { command: "ls" },
        error: "command not found",
        time: { start: 0, end: 1 },
      },
    }
    expect(formatParts("Assistant", [part])).toEqual(["[Tool bash] error: command not found"])
  })

  test("omits pending and running tool parts", () => {
    const pending: ToolPart = {
      id: "prt_4",
      sessionID: "ses_1",
      messageID: "msg_1",
      type: "tool",
      callID: "call_1",
      tool: "bash",
      state: { status: "pending", input: {}, raw: "" },
    }
    expect(formatParts("Assistant", [pending])).toEqual([])
  })

  test("formats a file part with filename fallback to url", () => {
    const withFilename: Part = {
      id: "prt_5",
      sessionID: "ses_1",
      messageID: "msg_1",
      type: "file",
      mime: "text/plain",
      filename: "a.txt",
      url: "file:///a.txt",
    }
    const withoutFilename: Part = {
      id: "prt_6",
      sessionID: "ses_1",
      messageID: "msg_1",
      type: "file",
      mime: "text/plain",
      url: "file:///b.txt",
    }
    expect(formatParts("User", [withFilename])).toEqual(["[File] a.txt"])
    expect(formatParts("User", [withoutFilename])).toEqual(["[File] file:///b.txt"])
  })
})

describe("formatMessages", () => {
  test("joins user and assistant turns with role labels", () => {
    const userMessage = { role: "user" } as UserMessage
    const assistantMessage = { role: "assistant" } as AssistantMessage

    const messages = [
      {
        info: userMessage,
        parts: [
          { id: "p1", sessionID: "s", messageID: "m1", type: "text", text: "hi" } as Part,
        ],
      },
      {
        info: assistantMessage,
        parts: [
          { id: "p2", sessionID: "s", messageID: "m2", type: "text", text: "hello back" } as Part,
        ],
      },
    ]

    expect(formatMessages(messages)).toBe("[User] hi\n\n[Assistant] hello back")
  })

  test("returns an empty string for no messages", () => {
    expect(formatMessages([])).toBe("")
  })
})

describe("McpServerAgent init", () => {
  test("exposes a start function without requiring the transport options up front", () => {
    const agent = McpServerAgent.init({ sdk: {} as any })
    expect(typeof agent.start).toBe("function")
  })
})

describe("mcp-server stdio integration", () => {
  test(
    "lists tools and round-trips session lifecycle calls over stdio",
    async () => {
      const transport = new StdioClientTransport({
        command: "bun",
        args: ["run", "src/index.ts", "mcp-server", "--transport", "stdio"],
        cwd: process.cwd(),
      })

      const client = new Client({ name: "test-client", version: "1.0.0" }, { capabilities: {} })

      try {
        await client.connect(transport)

        const toolsResult = await client.listTools()
        expect(toolsResult.tools.map((t) => t.name).sort()).toEqual(
          ["create_session", "get_context", "get_session", "interrupt_session", "list_sessions", "prompt"].sort(),
        )

        const createResult = await client.callTool({ name: "create_session", arguments: {} })
        const createText = firstText(createResult.content)
        const sessionId = JSON.parse(createText).session_id
        expect(typeof sessionId).toBe("string")

        const listResult = await client.callTool({ name: "list_sessions", arguments: {} })
        expect(firstText(listResult.content)).toContain(sessionId)

        const getResult = await client.callTool({ name: "get_session", arguments: { session_id: sessionId } })
        expect(JSON.parse(firstText(getResult.content)).session_id).toBe(sessionId)

        const missingResult = await client.callTool({ name: "get_session", arguments: { session_id: "ses_does_not_exist" } })
        expect(missingResult.isError).toBe(true)
      } finally {
        await client.close()
      }
    },
    60_000,
  )
})
