import { afterEach, describe, expect, mock, spyOn, test } from "bun:test"
import { jsonSchema } from "ai"
import z from "zod"
import type { Agent } from "../../src/agent/agent"
import { MCP } from "../../src/mcp"
import { Permission } from "../../src/permission"
import { Plugin } from "../../src/plugin"
import { ProjectID } from "../../src/project/schema"
import type { Provider } from "../../src/provider/provider"
import { ProviderID } from "../../src/provider/schema"
import type { MessageV2 } from "../../src/session/message-v2"
import type { SessionProcessor } from "../../src/session/processor"
import { SessionPrompt } from "../../src/session/prompt"
import { MessageID, SessionID } from "../../src/session/schema"
import type { Session } from "../../src/session"
import { ToolRegistry } from "../../src/tool/registry"
import { Truncate } from "../../src/tool/truncate"

afterEach(() => {
  mock.restore()
})

function createModel(): Provider.Model {
  return {
    id: "test-model",
    providerID: ProviderID.make("test"),
    name: "Test",
    limit: {
      context: 100_000,
      output: 32_000,
    },
    cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
    capabilities: {
      toolcall: true,
      attachment: false,
      reasoning: false,
      temperature: true,
      input: { text: true, image: false, audio: false, video: false },
      output: { text: true, image: false, audio: false, video: false },
    },
    api: {
      id: "test-model",
      npm: "@ai-sdk/openai",
    },
    options: {},
  } as Provider.Model
}

function input(): Parameters<(typeof SessionPrompt)["resolveTools"]>[0] {
  const model = createModel()
  const agent: Agent.Info = {
    name: "build",
    mode: "primary",
    permission: [],
    options: {},
  }
  const session: Session.Info = {
    id: SessionID.descending(),
    slug: "tool-hooks",
    projectID: ProjectID.global,
    directory: "/",
    title: "Tool hooks",
    version: "1",
    time: {
      created: Date.now(),
      updated: Date.now(),
    },
    permission: [],
  }
  const message: MessageV2.Assistant = {
    id: MessageID.ascending(),
    sessionID: SessionID.descending(),
    role: "assistant",
    time: { created: Date.now() },
    parentID: MessageID.ascending(),
    mode: "build",
    agent: "build",
    path: { cwd: "/", root: "/" },
    cost: 0,
    tokens: {
      input: 0,
      output: 0,
      reasoning: 0,
      cache: { read: 0, write: 0 },
    },
    modelID: model.id,
    providerID: model.providerID,
    finish: "end_turn",
  }
  const processor: SessionProcessor.Info = {
    message,
    partFromToolCall() {
      return undefined
    },
    process: async () => "stop",
  }

  return {
    agent,
    model,
    session,
    processor,
    bypassAgentCheck: false,
    messages: [],
  }
}

describe("session.prompt tool hooks", () => {
  test("tool.execute.before can replace undefined args for native tools", async () => {
    let captured: unknown

    spyOn(ToolRegistry, "tools").mockResolvedValue([
      {
        id: "native_demo",
        description: "Native demo",
        parameters: z.object({}),
        execute: async (args: unknown) => {
          captured = args
          return { title: "", output: "ok", metadata: {} }
        },
      },
    ] as never)
    spyOn(MCP, "tools").mockResolvedValue({})
    spyOn(Truncate, "output").mockResolvedValue({ content: "ok", truncated: false })
    spyOn(Plugin, "trigger").mockImplementation(async (name, _input, output) => {
      if (name === "tool.execute.before" && typeof output === "object" && output !== null && "args" in output) {
        Object.assign(output, { args: { __patched: true } })
      }
      return output
    })

    const tools = await SessionPrompt.resolveTools(input())
    if (!tools.native_demo?.execute) throw new Error("native_demo execute missing")
    await tools.native_demo.execute(undefined, {
      toolCallId: "call-native",
      abortSignal: new AbortController().signal,
      messages: [],
    })

    expect(captured).toEqual({ __patched: true })
  })

  test("tool.execute.before can replace undefined args for MCP tools", async () => {
    let captured: unknown

    spyOn(ToolRegistry, "tools").mockResolvedValue([])
    spyOn(MCP, "tools").mockResolvedValue({
      openkitten_echo: {
        description: "MCP demo",
        inputSchema: jsonSchema({
          type: "object",
          properties: {},
          additionalProperties: false,
        }),
        execute: async (args: unknown) => {
          captured = args
          return {
            content: [{ type: "text", text: "ok" }],
            metadata: {},
          }
        },
      },
    } as never)
    spyOn(Permission, "ask").mockResolvedValue(undefined)
    spyOn(Truncate, "output").mockResolvedValue({ content: "ok", truncated: false })
    spyOn(Plugin, "trigger").mockImplementation(async (name, _input, output) => {
      if (name === "tool.execute.before" && typeof output === "object" && output !== null && "args" in output) {
        Object.assign(output, { args: { __patched: true } })
      }
      return output
    })

    const tools = await SessionPrompt.resolveTools(input())
    if (!tools.openkitten_echo?.execute) throw new Error("openkitten_echo execute missing")
    await tools.openkitten_echo.execute(undefined, {
      toolCallId: "call-mcp",
      abortSignal: new AbortController().signal,
      messages: [],
    })

    expect(captured).toEqual({ __patched: true })
  })
})
