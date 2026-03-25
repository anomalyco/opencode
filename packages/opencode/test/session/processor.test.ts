import { afterEach, describe, expect, spyOn, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import type { Provider } from "../../src/provider/provider"
import { ModelID, ProviderID } from "../../src/provider/schema"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { MessageV2 } from "../../src/session/message-v2"
import { SessionProcessor } from "../../src/session/processor"
import { LLM } from "../../src/session/llm"
import { FileTime } from "../../src/file/time"
import { MessageID } from "../../src/session/schema"
import { tmpdir } from "../fixture/fixture"

const providerID = ProviderID.make("test")
const model: Provider.Model = {
  id: ModelID.make("test-model"),
  providerID,
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
      image: false,
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

afterEach(async () => {
  await Instance.disposeAll()
})

async function touch(file: string, time: number) {
  const date = new Date(time)
  await fs.utimes(file, date, date)
}

async function* full(items: unknown[]) {
  for (const item of items) {
    yield item
  }
}

describe("session.processor", () => {
  test("re-reads fresh content after stale FileTime tool errors", async () => {
    await using tmp = await tmpdir()
    const file = path.join(tmp.path, "file.txt")
    await fs.writeFile(file, "old\n", "utf-8")
    await touch(file, 1_000)

    const spy = spyOn(LLM, "stream").mockResolvedValue({
      fullStream: full([
        { type: "start" },
        { type: "tool-input-start", id: "call-1", toolName: "edit" },
        {
          type: "tool-call",
          toolCallId: "call-1",
          toolName: "edit",
          input: {
            filePath: file,
            oldString: "old\n",
            newString: "next\n",
          },
        },
        {
          type: "tool-error",
          toolCallId: "call-1",
          input: {
            filePath: file,
            oldString: "old\n",
            newString: "next\n",
          },
          error: new Error(
            `File ${file} has been modified since it was last read.\nLast modification: 1970-01-01T00:00:02.000Z\nLast read: 1970-01-01T00:00:01.000Z\n\nPlease read the file again before modifying it.`,
          ),
        },
        { type: "finish" },
      ]),
    } as never)

    try {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const session = await Session.create({})
          const user = (await Session.updateMessage({
            id: MessageID.ascending(),
            sessionID: session.id,
            role: "user",
            time: {
              created: Date.now(),
            },
            agent: "build",
            model: {
              providerID,
              modelID: model.id,
            },
          })) as MessageV2.User
          const assistant = (await Session.updateMessage({
            id: MessageID.ascending(),
            parentID: user.id,
            role: "assistant",
            sessionID: session.id,
            mode: "build",
            agent: "build",
            path: {
              cwd: tmp.path,
              root: tmp.path,
            },
            cost: 0,
            tokens: {
              input: 0,
              output: 0,
              reasoning: 0,
              cache: { read: 0, write: 0 },
            },
            modelID: model.id,
            providerID,
            time: {
              created: Date.now(),
            },
          })) as MessageV2.Assistant

          await FileTime.read(session.id, file)
          await fs.writeFile(file, "fresh\n", "utf-8")
          await touch(file, 2_000)
          await expect(FileTime.assert(session.id, file)).rejects.toThrow("modified since it was last read")

          const proc = SessionProcessor.create({
            assistantMessage: assistant,
            sessionID: session.id,
            model,
            abort: AbortSignal.any([]),
          })
          const result = await proc.process({
            user,
            sessionID: session.id,
            model,
            agent: {
              name: "build",
              description: "test",
              mode: "primary",
              permission: [],
              options: {},
            },
            system: [],
            abort: AbortSignal.any([]),
            messages: [],
            tools: {},
          } as never)

          expect(result).toBe("continue")
          await expect(FileTime.assert(session.id, file)).resolves.toBeUndefined()

          const msg = await MessageV2.get({
            sessionID: session.id,
            messageID: assistant.id,
          })
          const part = msg.parts.find((item) => item.type === "tool")
          expect(part?.type).toBe("tool")
          if (!part || part.type !== "tool" || part.state.status !== "error") {
            throw new Error("missing tool error part")
          }

          expect(part.state.metadata?.["filepath"]).toBe(file)
          expect(part.state.metadata?.["fresh"]).toBe("fresh\n")
          expect(part.state.error).toContain("Base your next edit on this fresh content")
          expect(part.state.error).toContain("<fresh-file")
          expect(part.state.error).toContain("fresh\n")
          expect(part.state.error).not.toContain("<fresh-file path=\"\"")

          const msgs = await Session.messages({
            sessionID: session.id,
          })
          const next = MessageV2.toModelMessages(msgs, model)
          const tool = next.findLast((item) => item.role === "tool")
          expect(tool?.role).toBe("tool")
          if (!tool || tool.role !== "tool") {
            throw new Error("missing tool message")
          }

          const out = Array.isArray(tool.content) ? tool.content[0] : undefined
          expect(out?.type).toBe("tool-result")
          if (!out || out.type !== "tool-result" || out.output.type !== "error-text") {
            throw new Error("missing tool error output")
          }

          expect(out.output.value).toContain("fresh\n")
          expect(out.output.value).toContain("previous stale oldString")
        },
      })
    } finally {
      spy.mockRestore()
    }
  })
})
