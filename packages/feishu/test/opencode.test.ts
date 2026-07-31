import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, mkdir, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Flag } from "@opencode-ai/core/flag/flag"
import {
  assertConfiguredModelAvailable,
  createChatPort,
  createEmbeddedChatPort,
  type SessionAssistant,
  type SessionRuntime,
  type SessionRuntimeEvent,
} from "../src/opencode"
import type { GatewayConfig } from "../src/config"
import type { GatewayTask } from "../src/store"

const directories: string[] = []
const servers: Bun.Server<unknown>[] = []
const originalDatabase = Flag.OPENCODE_DB

afterEach(async () => {
  Flag.OPENCODE_DB = originalDatabase
  await Promise.all(servers.splice(0).map((server) => server.stop(true)))
  await Promise.all(
    directories.splice(0).map((directory) => removeDirectory(directory)),
  )
})

describe("embedded OpenCode chat", () => {
  test(
    "uses the real embedded router for deterministic prompt retry and final projection",
    async () => {
      const directory = await workspace()
      const server = llmServer()
      await writeProviderConfig(directory, `http://127.0.0.1:${server.port}/v1`)
      Flag.OPENCODE_DB = join(directory, "opencode.sqlite")
      const evidence: unknown[] = []
      const port = await createEmbeddedChatPort({
        config: config(directory),
        record: async (_task, event) => {
          evidence.push(event)
        },
        modelTimeoutMs: 10_000,
      })

      try {
        const first = await port.complete(task())
        const callsAfterFirst = server.calls()
        const repeated = await port.complete(task())
        if (!first.ok) {
          throw new Error(
            `embedded provider fixture failed before projection: calls=${callsAfterFirst} evidence=${JSON.stringify(evidence)}`,
          )
        }

        expect(first).toEqual({
          ok: true,
          value: {
            text: "最终回答",
            model: { providerID: "test", modelID: "test-model" },
            tokens: { input: 11, output: 7, reasoning: 3 },
            cost: 0,
            durationMs: expect.any(Number),
          },
        })
        expect(repeated).toEqual({
          ok: true,
          value: expect.objectContaining({
            text: "最终回答",
            model: { providerID: "test", modelID: "test-model" },
            tokens: { input: 11, output: 7, reasoning: 3 },
            cost: 0,
          }),
        })
        expect(server.calls()).toBe(callsAfterFirst)
        expect(evidence).toContainEqual(
          expect.objectContaining({
            type: "session_reconciled",
            sessionID: task().sessionID,
            promptMessageID: task().promptMessageID,
            agent: "feishu-chat",
            model: { providerID: "test", modelID: "test-model" },
          }),
        )
        expect(JSON.stringify(evidence)).not.toContain("hidden reasoning")
      } finally {
        await port.close()
      }
    },
    20_000,
  )

  test("fails startup preflight when the configured model is unavailable", async () => {
    expect(() =>
      assertConfiguredModelAvailable(
        { providerID: "missing", modelID: "missing-model" },
        [{ providerID: "deepseek", id: "deepseek-chat" }],
      ),
    ).toThrow("Configured model is unavailable")
  })

  test("projects only final text and metadata while excluding reasoning", async () => {
    const runtime = new FakeRuntime({
      messageID: "msg_assistant_1",
      agent: "feishu-chat",
      model: { providerID: "deepseek", modelID: "deepseek-chat" },
      content: [
        { type: "reasoning", text: "hidden reasoning" },
        { type: "text", text: "最终" },
        { type: "text", text: "回答" },
      ],
      tokens: { input: 10, output: 4, reasoning: 2 },
      cost: 0.001,
    })
    const evidence: unknown[] = []
    const port = createChatPort({
      runtime,
      record: async (_task, event) => {
        evidence.push(event)
      },
      now: time([100, 145]),
      modelTimeoutMs: 1_000,
    })

    expect(await port.complete(task())).toEqual({
      ok: true,
      value: {
        text: "最终回答",
        model: { providerID: "deepseek", modelID: "deepseek-chat" },
        tokens: { input: 10, output: 4, reasoning: 2 },
        cost: 0.001,
        durationMs: 45,
      },
    })
    expect(JSON.stringify(evidence)).not.toContain("hidden reasoning")
  })

  test("interrupts and blocks every tool request without producing a tool result", async () => {
    const runtime = new FakeRuntime({
      messageID: "msg_assistant_1",
      agent: "feishu-chat",
      model: { providerID: "deepseek", modelID: "deepseek-chat" },
      content: [],
    })
    runtime.events = [{ type: "tool_called", tool: "bash", input: { command: "whoami" }, executed: false }]
    const evidence: unknown[] = []
    const port = createChatPort({
      runtime,
      record: async (_task, event) => {
        evidence.push(event)
      },
      modelTimeoutMs: 1_000,
    })

    expect(await port.complete(task())).toEqual({
      ok: false,
      error: {
        kind: "policy",
        retryable: false,
        message: "This chat cannot execute tools.",
      },
    })
    expect(runtime.interruptions).toEqual([task().sessionID])
    expect(evidence).toContainEqual({
      type: "operation_blocked",
      tool: "bash",
      executed: false,
      interrupted: true,
    })
    expect(evidence.some((event) => JSON.stringify(event).includes("tool_result"))).toBeFalse()
  })

  test("classifies provider, authentication, rate-limit, and empty-output failures without upstream secrets", async () => {
    const cases = [
      {
        error: { statusCode: 401, message: "api-key-canary" },
        expected: { kind: "authentication", retryable: false, message: "Model authentication failed." },
      },
      {
        error: { statusCode: 429, message: "api-key-canary" },
        expected: { kind: "rate_limit", retryable: true, message: "The model is temporarily rate limited." },
      },
      {
        error: { statusCode: 500, message: "api-key-canary" },
        expected: { kind: "provider", retryable: true, message: "The model request failed." },
      },
    ] as const

    for (const item of cases) {
      const runtime = new FakeRuntime(item.error)
      const result = await createChatPort({ runtime, modelTimeoutMs: 1_000 }).complete(task())
      expect(result).toEqual({ ok: false, error: item.expected })
      expect(JSON.stringify(result)).not.toContain("api-key-canary")
    }

    const empty = new FakeRuntime({
      messageID: "msg_assistant_1",
      agent: "feishu-chat",
      model: { providerID: "deepseek", modelID: "deepseek-chat" },
      content: [{ type: "reasoning", text: "hidden reasoning" }],
    })
    expect(await createChatPort({ runtime: empty, modelTimeoutMs: 1_000 }).complete(task())).toEqual({
      ok: false,
      error: {
        kind: "empty_output",
        retryable: false,
        message: "The model returned no final text.",
      },
    })
  })

  test("times out, interrupts the Session, and returns one sanitized failure", async () => {
    const runtime = new FakeRuntime(new Promise<never>(() => undefined))
    const port = createChatPort({ runtime, modelTimeoutMs: 10 })

    expect(await port.complete(task())).toEqual({
      ok: false,
      error: {
        kind: "timeout",
        retryable: true,
        message: "The model request timed out.",
      },
    })
    expect(runtime.interruptions).toEqual([task().sessionID])
  })
})

class FakeRuntime implements SessionRuntime {
  events: SessionRuntimeEvent[] = []
  interruptions: string[] = []

  constructor(
    readonly result:
      | SessionAssistant
      | { statusCode: number; message: string }
      | Promise<SessionAssistant>,
  ) {}

  async execute(_task: GatewayTask, onEvent: (event: SessionRuntimeEvent) => Promise<void>) {
    for (const event of this.events) await onEvent(event)
    if (this.result instanceof Promise) return this.result
    if ("statusCode" in this.result) throw this.result
    return this.result
  }

  async interrupt(sessionID: string) {
    this.interruptions.push(sessionID)
    return true
  }

  async close() {}
}

async function workspace() {
  const directory = await mkdtemp(join(tmpdir(), "feishu-opencode-"))
  directories.push(directory)
  await mkdir(join(directory, ".opencode", "agent"), { recursive: true })
  await Bun.write(
    join(directory, ".opencode", "agent", "feishu-chat.md"),
    `---
mode: primary
hidden: true
tools:
  "*": false
permission:
  "*": deny
---
Return plain text only.
`,
  )
  return directory
}

async function writeProviderConfig(directory: string, baseURL: string) {
  await Bun.write(
    join(directory, "opencode.json"),
    JSON.stringify({
      formatter: false,
      lsp: false,
      provider: {
        test: {
          name: "Test",
          id: "test",
          npm: "@ai-sdk/openai-compatible",
          models: {
            "test-model": {
              id: "test-model",
              name: "Test Model",
              attachment: false,
              reasoning: true,
              temperature: false,
              tool_call: true,
              release_date: "2025-01-01",
              limit: { context: 100_000, output: 10_000 },
              cost: { input: 0, output: 0 },
              options: {},
            },
          },
          options: { apiKey: "test-key", baseURL },
        },
      },
    }),
  )
}

function llmServer() {
  let calls = 0
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      calls++
      await request.json()
      const chunks = [
        chunk({ role: "assistant" }),
        chunk({ reasoning_content: "hidden reasoning" }),
        chunk({ content: "最终回答" }),
        chunk({}, "stop", {
          prompt_tokens: 11,
          completion_tokens: 10,
          total_tokens: 21,
          completion_tokens_details: { reasoning_tokens: 3 },
        }),
      ]
      return new Response(chunks.map((value) => `data: ${JSON.stringify(value)}\n\n`).join("") + "data: [DONE]\n\n", {
        headers: { "content-type": "text/event-stream" },
      })
    },
  })
  servers.push(server)
  return {
    port: server.port,
    calls: () => calls,
  }
}

function chunk(
  delta: Record<string, unknown>,
  finishReason?: string,
  usage?: {
    prompt_tokens: number
    completion_tokens: number
    total_tokens: number
    completion_tokens_details?: { reasoning_tokens: number }
  },
) {
  return {
    id: "chatcmpl-feishu",
    object: "chat.completion.chunk",
    choices: [{ delta, ...(finishReason ? { finish_reason: finishReason } : {}) }],
    ...(usage ? { usage } : {}),
  }
}

function config(directory: string): GatewayConfig {
  return {
    appID: "cli_test",
    appSecret: "secret-canary",
    model: { providerID: "test", modelID: "test-model" },
    dataDirectory: directory,
    workspaceDirectory: directory,
    maxConcurrency: 4,
    replyAttempts: 3,
    replyTimeoutMs: 15_000,
  }
}

function task(): GatewayTask {
  return {
    id: "task_1",
    externalMessageHash: "hash_1",
    conversationID: "conv_1",
    sessionID: "ses_feishu_0123456789abcdef0123456789abcdef0123456789abcdef",
    promptMessageID: "msg_feishu_0123456789abcdef0123456789abcdef0123456789abcdef",
    turnID: "turn_1",
    traceID: "trace_1",
    promptText: "请只回答最终文本",
    originalText: "请只回答最终文本",
    replyTarget: "oc_chat_1",
    state: "running",
    receiveSequence: 1,
    sendAttempts: 0,
  }
}

function time(values: readonly number[]) {
  let index = 0
  return () => values[Math.min(index++, values.length - 1)]
}

async function removeDirectory(directory: string, retries = 30): Promise<void> {
  try {
    await rm(directory, { recursive: true, force: true })
  } catch (error) {
    if (
      retries === 0 ||
      typeof error !== "object" ||
      error === null ||
      !("code" in error) ||
      error.code !== "EBUSY"
    )
      throw error
    Bun.gc(true)
    await Bun.sleep(100)
    return removeDirectory(directory, retries - 1)
  }
}
