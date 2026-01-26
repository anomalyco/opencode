import { describe, expect, test } from "bun:test"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { SessionProcessor } from "../../src/session/processor"
import { MessageV2 } from "../../src/session/message-v2"
import { Provider } from "../../src/provider/provider"
import { Agent } from "../../src/agent/agent"
import { Identifier } from "../../src/id/id"

describe("session.timeout.retry", () => {
  test(
    "retries timed-out model requests up to the configured max",
    async () => {
      const calls = { value: 0 }
      using server = Bun.serve({
        port: 0,
        async fetch() {
          calls.value += 1
          await Bun.sleep(200)
          return new Response(JSON.stringify({ ok: true }), {
            headers: { "content-type": "application/json" },
          })
        },
      })

      await using tmp = await tmpdir({
        config: {
          experimental: {
            chatMaxRetries: 1,
          },
          provider: {
            timeout: {
              name: "Timeout Provider",
              api: `${server.url.origin}/v1`,
              options: {
                timeout: 50,
              },
              models: {
                slow: {
                  name: "Slow Model",
                  limit: {
                    context: 8000,
                    output: 1000,
                  },
                  temperature: true,
                },
              },
            },
          },
        },
      })

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const agent = await Agent.get("build")
          if (!agent) throw new Error("agent not found")

          const session = await Session.create({})
          const model = await Provider.getModel("timeout", "slow")
          const uid = Identifier.ascending("message")
          const aid = Identifier.ascending("message")

          const user: MessageV2.User = {
            id: uid,
            sessionID: session.id,
            role: "user",
            time: { created: Date.now() },
            agent: agent.name,
            model: {
              providerID: model.providerID,
              modelID: model.id,
            },
            tools: {},
          }
          await Session.updateMessage(user)

          const part: MessageV2.Part = {
            id: Identifier.ascending("part"),
            sessionID: session.id,
            messageID: user.id,
            type: "text",
            text: "Hello",
          }
          await Session.updatePart(part)

          const assistant: MessageV2.Assistant = {
            id: aid,
            sessionID: session.id,
            role: "assistant",
            time: { created: Date.now() },
            parentID: user.id,
            modelID: model.id,
            providerID: model.providerID,
            mode: agent.name,
            agent: agent.name,
            path: { cwd: Instance.directory, root: Instance.worktree },
            cost: 0,
            tokens: {
              input: 0,
              output: 0,
              reasoning: 0,
              cache: { read: 0, write: 0 },
            },
          }
          await Session.updateMessage(assistant)

          const abort = new AbortController()
          const processor = SessionProcessor.create({
            assistantMessage: assistant,
            sessionID: session.id,
            model,
            abort: abort.signal,
          })
          const result = await processor.process({
            user,
            agent,
            abort: abort.signal,
            sessionID: session.id,
            system: [],
            messages: MessageV2.toModelMessages(
              [
                {
                  info: user,
                  parts: [part],
                },
              ],
              model,
            ),
            tools: {},
            model,
          })

          expect(result).toBe("stop")
          expect(calls.value).toBe(2)
          expect(assistant.error?.name).toBe("APIError")
          if (assistant.error?.name === "APIError") {
            expect(assistant.error.data.message).toBe("Request timed out")
          }

          await Session.remove(session.id)
        },
      })
    },
    30_000,
  )
})
