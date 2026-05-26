import { describe, expect, spyOn, test } from "bun:test"
import type { Agent } from "../../src/agent/agent"
import { Identifier } from "../../src/id/id"
import type { Provider } from "../../src/provider/provider"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { SessionCompaction } from "../../src/session/compaction"
import { LLM } from "../../src/session/llm"
import { MessageV2 } from "../../src/session/message-v2"
import { SessionProcessor } from "../../src/session/processor"
import { SessionRetry } from "../../src/session/retry"
import { SessionSummary } from "../../src/session/summary"
import { tmpdir } from "../fixture/fixture"

const model: Provider.Model = {
  id: "test-model",
  providerID: "test",
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

const agent = {
  name: "test",
  mode: "primary",
  options: {},
  permission: [{ permission: "*", pattern: "*", action: "allow" }],
} satisfies Agent.Info

function user(id: string, session: string): MessageV2.User {
  return {
    id,
    sessionID: session,
    role: "user",
    time: { created: Date.now() },
    agent: agent.name,
    model: { providerID: model.providerID, modelID: model.id },
    tools: {},
    mode: "",
  } as unknown as MessageV2.User
}

function assistant(id: string, session: string, parent: string): MessageV2.Assistant {
  return {
    id,
    sessionID: session,
    role: "assistant",
    parentID: parent,
    time: { created: Date.now() },
    modelID: model.id,
    providerID: model.providerID,
    mode: agent.name,
    agent: agent.name,
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

function stalled<T>(chunks: T[], cancel: () => void): AsyncIterable<T> {
  return {
    [Symbol.asyncIterator]() {
      let index = 0
      return {
        async next() {
          if (index < chunks.length) {
            return { done: false, value: chunks[index++] }
          }
          return new Promise<IteratorResult<T>>(() => {})
        },
        async return() {
          cancel()
          return { done: true, value: undefined }
        },
      }
    },
  }
}

async function process(stream: AsyncIterable<unknown>) {
  await using tmp = await tmpdir({
    git: true,
  })

  return Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const session = await Session.create({})
      const parent = Identifier.ascending("message")
      const message = Identifier.ascending("message")
      const abort = new AbortController()
      const current = user(parent, session.id)
      const processor = SessionProcessor.create({
        assistantMessage: (await Session.updateMessage(assistant(message, session.id, parent))) as MessageV2.Assistant,
        sessionID: session.id,
        model,
        abort: abort.signal,
        timeout: {
          firstByte: 5,
          idle: 5,
        },
      })
      const delay = spyOn(SessionRetry, "delay").mockImplementation(() => 1)
      const llm = spyOn(LLM, "stream").mockImplementation(async () => {
        return { fullStream: stream } as unknown as Awaited<ReturnType<typeof LLM.stream>>
      })
      try {
        const result = await processor.process({
          user: current,
          sessionID: session.id,
          model,
          agent,
          system: [],
          abort: abort.signal,
          messages: [],
          tools: {},
        })
        return {
          result,
          calls: llm.mock.calls.length,
          message: processor.message,
          parts: await MessageV2.parts(message),
        }
      } finally {
        delay.mockRestore()
        llm.mockRestore()
        await Session.remove(session.id)
      }
    },
  })
}

describe("session.processor stream watchdog", () => {
  test("retries and stops when stream never yields first chunk", async () => {
    let canceled = 0
    const output = await process(stalled([], () => canceled++))

    expect(output.result).toBe("stop")
    expect(output.calls).toBe(SessionProcessor.RETRY_MAX + 1)
    expect(canceled).toBe(SessionProcessor.RETRY_MAX + 1)
    expect(output.message.error?.name).toBe("APIError")
    expect(output.message.error?.data.message).toContain("Stream first byte timed out")
  })

  test("retries and stops when stream idles after first chunk", async () => {
    let canceled = 0
    const output = await process(
      stalled(
        [
          { type: "text-start" },
          { type: "text-delta", text: "hello" },
          { type: "text-end" },
        ],
        () => canceled++,
      ),
    )

    expect(output.result).toBe("stop")
    expect(output.calls).toBe(SessionProcessor.RETRY_MAX + 1)
    expect(canceled).toBe(SessionProcessor.RETRY_MAX + 1)
    expect(output.message.error?.name).toBe("APIError")
    expect(output.message.error?.data.message).toContain("Stream idle timed out")
    expect(output.parts.some((part) => part.type === "text" && part.text.includes("hello"))).toBe(true)
  })

  test("closes provider stream when compaction exits stream early", async () => {
    let canceled = 0
    const overflow = spyOn(SessionCompaction, "isOverflow").mockImplementation(async () => true)
    const summary = spyOn(SessionSummary, "summarize").mockImplementation(async () => {})
    try {
      const output = await process(
        stalled(
          [
            {
              type: "finish-step",
              finishReason: "stop",
              usage: {
                inputTokens: 1,
                outputTokens: 1,
                totalTokens: 2,
              },
            },
          ],
          () => canceled++,
        ),
      )

      expect(output.result).toBe("compact")
      expect(output.calls).toBe(1)
      expect(canceled).toBe(1)
    } finally {
      summary.mockRestore()
      overflow.mockRestore()
    }
  })
})
