import path from "path"
import { describe, expect, test } from "bun:test"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { SessionPrompt } from "../../src/session/prompt"
import { Log } from "../../src/util/log"
import { tmpdir } from "../fixture/fixture"
import { ModelID, ProviderID } from "../../src/provider/schema"

Log.init({ print: false })

function chat(text: string) {
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
    start(ctrl) {
      ctrl.enqueue(encoder.encode(payload))
      ctrl.close()
    },
  })
}

describe("session.ask", () => {
  test("returns a direct text response without modifying session messages", async () => {
    let calls = 0
    const server = Bun.serve({
      port: 0,
      fetch(req) {
        const url = new URL(req.url)
        if (!url.pathname.endsWith("/chat/completions")) {
          return new Response("not found", { status: 404 })
        }
        calls++
        return new Response(chat("The current model is qwen-plus."), {
          status: 200,
          headers: { "Content-Type": "text/event-stream" },
        })
      },
    })

    try {
      await using tmp = await tmpdir({
        git: true,
        init: async (dir) => {
          await Bun.write(
            path.join(dir, "opencode.json"),
            JSON.stringify({
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
            }),
          )
        },
      })

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const session = await Session.create({ title: "Ask test" })

          // Seed a user message so /ask has context
          await SessionPrompt.prompt({
            sessionID: session.id,
            agent: "build",
            noReply: true,
            parts: [{ type: "text", text: "Hello, what model am I using?" }],
          })

          const msgsBefore = await Session.messages({ sessionID: session.id })
          const countBefore = msgsBefore.length

          const response = await SessionPrompt.ask({
            sessionID: session.id,
            question: "What model am I using?",
            providerID: "alibaba" as ProviderID,
            modelID: "qwen-plus" as ModelID,
          })

          expect(typeof response).toBe("string")
          expect(response.length).toBeGreaterThan(0)
          expect(response).toContain("qwen-plus")

          // /ask must NOT add messages to the session
          const msgsAfter = await Session.messages({ sessionID: session.id })
          expect(msgsAfter.length).toBe(countBefore)

          // The LLM was called exactly once for the side question
          expect(calls).toBe(1)

          await Session.remove(session.id)
        },
      })
    } finally {
      server.stop(true)
    }
  })

  test("works on an empty session with no prior messages", async () => {
    const server = Bun.serve({
      port: 0,
      fetch(req) {
        const url = new URL(req.url)
        if (!url.pathname.endsWith("/chat/completions")) {
          return new Response("not found", { status: 404 })
        }
        return new Response(chat("I am a helpful assistant."), {
          status: 200,
          headers: { "Content-Type": "text/event-stream" },
        })
      },
    })

    try {
      await using tmp = await tmpdir({
        git: true,
        init: async (dir) => {
          await Bun.write(
            path.join(dir, "opencode.json"),
            JSON.stringify({
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
            }),
          )
        },
      })

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const session = await Session.create({ title: "Ask empty session" })

          const response = await SessionPrompt.ask({
            sessionID: session.id,
            question: "Who are you?",
            providerID: "alibaba" as ProviderID,
            modelID: "qwen-plus" as ModelID,
          })

          expect(typeof response).toBe("string")
          expect(response.length).toBeGreaterThan(0)

          // Still no messages in the session
          const msgs = await Session.messages({ sessionID: session.id })
          expect(msgs.length).toBe(0)

          await Session.remove(session.id)
        },
      })
    } finally {
      server.stop(true)
    }
  })

  test("strips thinking tags from the response", async () => {
    const server = Bun.serve({
      port: 0,
      fetch(req) {
        const url = new URL(req.url)
        if (!url.pathname.endsWith("/chat/completions")) {
          return new Response("not found", { status: 404 })
        }
        return new Response(chat("<think>internal reasoning</think>The answer is 42."), {
          status: 200,
          headers: { "Content-Type": "text/event-stream" },
        })
      },
    })

    try {
      await using tmp = await tmpdir({
        git: true,
        init: async (dir) => {
          await Bun.write(
            path.join(dir, "opencode.json"),
            JSON.stringify({
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
            }),
          )
        },
      })

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const session = await Session.create({ title: "Ask thinking strip" })

          const response = await SessionPrompt.ask({
            sessionID: session.id,
            question: "What is the meaning of life?",
            providerID: "alibaba" as ProviderID,
            modelID: "qwen-plus" as ModelID,
          })

          expect(response).toBe("The answer is 42.")
          expect(response).not.toContain("<think>")

          await Session.remove(session.id)
        },
      })
    } finally {
      server.stop(true)
    }
  })
})
