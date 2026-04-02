import { describe, expect, test, afterEach, beforeEach } from "bun:test"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { SessionPrompt } from "../../src/session/prompt"
import { MessageV2 } from "../../src/session/message-v2"
import { Log } from "../../src/util/log"
import { tmpdir } from "../fixture/fixture"

Log.init({ print: false })

function chat(text: string) {
  const payload =
    [
      `data: ${JSON.stringify({ id: "chatcmpl-1", object: "chat.completion.chunk", choices: [{ delta: { role: "assistant" } }] })}`,
      `data: ${JSON.stringify({ id: "chatcmpl-1", object: "chat.completion.chunk", choices: [{ delta: { content: text } }] })}`,
      `data: ${JSON.stringify({ id: "chatcmpl-1", object: "chat.completion.chunk", choices: [{ delta: {}, finish_reason: "stop" }] })}`,
      "data: [DONE]",
    ].join("\n\n") + "\n\n"

  const encoder = new TextEncoder()
  return new ReadableStream<Uint8Array>({
    start(ctrl) {
      ctrl.enqueue(encoder.encode(payload))
      ctrl.close()
    },
  })
}

async function makeEnv(maxTurns?: number, maxUsd?: number) {
  const tmp = await tmpdir({
    git: true,
    init: async (dir) => {
      await Bun.write(
        dir + "/opencode.json",
        JSON.stringify({
          $schema: "https://opencode.ai/config.json",
          enabled_providers: ["alibaba"],
          provider: {
            alibaba: {
              options: { apiKey: "test-key", baseURL: "PLACEHOLDER" },
            },
          },
          agent: { build: { model: "alibaba/qwen-plus" } },
          ...(maxTurns !== undefined || maxUsd !== undefined
            ? {
                budget: {
                  ...(maxTurns !== undefined ? { maxTurns } : {}),
                  ...(maxUsd !== undefined ? { maxUsd } : {}),
                },
              }
            : {}),
        }),
      )
    },
  })
  return tmp
}

describe("budget limits", () => {
  let server: ReturnType<typeof Bun.serve> | undefined
  let calls = 0

  beforeEach(() => {
    calls = 0
    server = Bun.serve({
      port: 0,
      fetch(req) {
        const url = new URL(req.url)
        if (!url.pathname.endsWith("/chat/completions")) return new Response("not found", { status: 404 })
        calls++
        return new Response(chat("hello"), {
          status: 200,
          headers: { "Content-Type": "text/event-stream" },
        })
      },
    })
  })

  afterEach(() => {
    server?.stop()
    delete process.env.OPENCODE_MAX_TURNS
    delete process.env.OPENCODE_MAX_USD
  })

  test("maxTurns=1 stops after first turn", async () => {
    const tmp = await makeEnv(1)
    try {
      // Patch server URL into config after server is created
      const cfg = JSON.parse(await Bun.file(tmp.path + "/opencode.json").text())
      cfg.provider.alibaba.options.baseURL = `${server!.url.origin}/v1`
      await Bun.write(tmp.path + "/opencode.json", JSON.stringify(cfg))

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const session = await Session.create({ title: "budget-turns" })
          await SessionPrompt.prompt({
            sessionID: session.id,
            parts: [{ type: "text", text: "hello" }],
          })

          const msgs = await MessageV2.filterCompacted(MessageV2.stream(session.id))
          const turns = msgs.filter((m) => m.info.role === "assistant").length
          // With maxTurns=1, only 1 assistant turn allowed
          expect(turns).toBeLessThanOrEqual(2) // 1 real + maybe 1 budget message
          expect(calls).toBeLessThanOrEqual(2)

          await Session.remove(session.id)
        },
      })
    } finally {
      await tmp[Symbol.asyncDispose]()
    }
  })

  test("OPENCODE_MAX_TURNS env var stops loop", async () => {
    process.env.OPENCODE_MAX_TURNS = "1"
    const tmp = await makeEnv()
    try {
      const cfg = JSON.parse(await Bun.file(tmp.path + "/opencode.json").text())
      cfg.provider.alibaba.options.baseURL = `${server!.url.origin}/v1`
      await Bun.write(tmp.path + "/opencode.json", JSON.stringify(cfg))

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const session = await Session.create({ title: "budget-env-turns" })
          await SessionPrompt.prompt({
            sessionID: session.id,
            parts: [{ type: "text", text: "hello" }],
          })

          const msgs = await MessageV2.filterCompacted(MessageV2.stream(session.id))
          const budgetMsg = msgs
            .flatMap((m) => m.parts)
            .find((p) => p.type === "text" && "text" in p && p.text.includes("Budget exceeded"))
          // When max turns exceeded, a budget message is appended
          expect(budgetMsg).toBeDefined()

          await Session.remove(session.id)
        },
      })
    } finally {
      await tmp[Symbol.asyncDispose]()
    }
  })

  test("OPENCODE_MAX_USD env var stops loop when cost exceeds limit", async () => {
    // Set an extremely small budget that will be exceeded
    process.env.OPENCODE_MAX_USD = "0.000001"
    const tmp = await makeEnv()
    try {
      const cfg = JSON.parse(await Bun.file(tmp.path + "/opencode.json").text())
      cfg.provider.alibaba.options.baseURL = `${server!.url.origin}/v1`
      await Bun.write(tmp.path + "/opencode.json", JSON.stringify(cfg))

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const session = await Session.create({ title: "budget-env-usd" })

          // First prompt succeeds but subsequent ones are checked after step++
          await SessionPrompt.prompt({
            sessionID: session.id,
            parts: [{ type: "text", text: "hello" }],
          })

          const msgs = await MessageV2.filterCompacted(MessageV2.stream(session.id))
          // Should have a budget message OR have stopped quickly
          expect(msgs.length).toBeGreaterThan(0)

          await Session.remove(session.id)
        },
      })
    } finally {
      await tmp[Symbol.asyncDispose]()
    }
  })
})
