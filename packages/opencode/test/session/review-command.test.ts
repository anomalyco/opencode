import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { pathToFileURL } from "url"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { SessionPrompt } from "../../src/session/prompt"
import { Log } from "../../src/util/log"

Log.init({ print: false })

function createChatStream(text: string) {
  const payload =
    [
      `data: ${JSON.stringify({
        id: "chatcmpl-1",
        object: "chat.completion.chunk",
        choices: [{ delta: { role: "assistant" } }],
      })}`,
      `data: ${JSON.stringify({
        id: "chatcmpl-1",
        object: "chat.completion.chunk",
        choices: [{ delta: { content: text } }],
      })}`,
      `data: ${JSON.stringify({
        id: "chatcmpl-1",
        object: "chat.completion.chunk",
        choices: [{ delta: {}, finish_reason: "stop" }],
      })}`,
      "data: [DONE]",
    ].join("\n\n") + "\n\n"

  const encoder = new TextEncoder()
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(payload))
      controller.close()
    },
  })
}

const state = {
  server: null as ReturnType<typeof Bun.serve> | null,
}

beforeAll(() => {
  state.server = Bun.serve({
    port: 0,
    async fetch(req) {
      const url = new URL(req.url)
      if (!url.pathname.endsWith("/chat/completions")) {
        return new Response("not found", { status: 404 })
      }
      return new Response(createChatStream("Looks fine."), {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      })
    },
  })
})

afterEach(async () => {
  await Instance.disposeAll()
})

afterAll(() => {
  state.server?.stop()
})

describe("session.command review", () => {
  test("normalizes plugin hook identifiers for review subtasks", async () => {
    const server = state.server
    if (!server) throw new Error("server not initialized")
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-review-command-"))
    const plugin = path.join(dir, "hook-plugin.ts")
    const log = path.join(dir, "hook-log.json")

    try {
      await Bun.write(
        plugin,
        [
          'import fs from "fs/promises"',
          'import path from "path"',
          "",
          "export default async ({ directory }) => {",
          '  const log = path.join(directory, "hook-log.json")',
          "  const entries = []",
          "  async function save(entry) {",
          "    entries.push(entry)",
          "    await fs.writeFile(log, JSON.stringify(entries, null, 2))",
          "  }",
          "  return {",
          '    "command.execute.before": async (_input, output) => {',
          "      await save({",
          '        type: "command",',
          "        parts: output.parts.map((part) => ({",
          "          type: part.type,",
          "          id: part.id,",
          "          sessionID: part.sessionID,",
          "          messageID: part.messageID,",
          "        })),",
          "      })",
          '      output.parts.unshift({ type: "text", text: "plugin note" })',
          "    },",
          '    "tool.execute.before": async (input) => {',
          '      if (input.tool !== "task") return',
          '      await save({ type: "before", callID: input.callID })',
          "    },",
          '    "tool.execute.after": async (input) => {',
          '      if (input.tool !== "task") return',
          '      await save({ type: "after", callID: input.callID })',
          "    },",
          "  }",
          "}",
          "",
        ].join("\n"),
      )
      await Bun.write(
        path.join(dir, "opencode.json"),
        JSON.stringify(
          {
            $schema: "https://opencode.ai/config.json",
            enabled_providers: ["alibaba"],
            provider: {
              alibaba: {
                options: {
                  apiKey: "test-key",
                  baseURL: `${server.url.origin}/v1`,
                },
              },
            },
            agent: {
              build: {
                model: "alibaba/qwen-plus",
              },
            },
            plugin: [pathToFileURL(plugin).href],
          },
          null,
          2,
        ),
      )

      const result = await Instance.provide({
        directory: dir,
        fn: async () => {
          const session = await Session.create({})
          await SessionPrompt.command({
            sessionID: session.id,
            command: "review",
            arguments: "",
            agent: "build",
            model: "alibaba/qwen-plus",
          })
          const messages = await Session.messages({ sessionID: session.id })
          return {
            sessionID: session.id,
            messages,
          }
        },
      })

      const entries = await Bun.file(log).json()
      const cmd = entries.find((entry: any) => entry.type === "command")
      const before = entries.find((entry: any) => entry.type === "before")
      const after = entries.find((entry: any) => entry.type === "after")
      const user = result.messages.find((msg) => msg.info.id === cmd.parts[0].messageID)
      const task = result.messages
        .flatMap((msg) => msg.parts)
        .find((part) => part.type === "tool" && part.tool === "task")

      expect(cmd).toBeDefined()
      expect(before).toBeDefined()
      expect(after).toBeDefined()
      expect(user?.parts.some((part) => part.type === "text" && part.text === "plugin note")).toBe(true)
      expect(cmd.parts.every((part: any) => typeof part.id === "string" && part.id.startsWith("prt_"))).toBe(true)
      expect(cmd.parts.every((part: any) => part.sessionID === result.sessionID)).toBe(true)
      expect(cmd.parts.every((part: any) => typeof part.messageID === "string" && part.messageID.startsWith("msg_"))).toBe(true)
      expect(task?.type).toBe("tool")
      if (!task || task.type !== "tool") throw new Error("task tool part not found")
      expect(before.callID).toBe(task.callID)
      expect(after.callID).toBe(task.callID)
      expect(before.callID.startsWith("prt_")).toBe(false)
    } finally {
      await Instance.disposeAll()
      await fs.rm(dir, {
        recursive: true,
        force: true,
        maxRetries: 5,
        retryDelay: 100,
      })
    }
  }, 30000)
})
