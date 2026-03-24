import { afterEach, describe, expect, mock, spyOn, test } from "bun:test"
import path from "path"
import type { ModelMessage } from "ai"
import { GitLabWorkflowLanguageModel } from "gitlab-ai-provider"
import type { Agent } from "../../src/agent/agent"
import { Env } from "../../src/env"
import { Instance } from "../../src/project/instance"
import { Provider } from "../../src/provider/provider"
import { ModelID, ProviderID } from "../../src/provider/schema"
import type { MessageV2 } from "../../src/session/message-v2"
import { LLM } from "../../src/session/llm"
import { MessageID, SessionID } from "../../src/session/schema"
import { Session } from "../../src/session"
import { SessionPrompt } from "../../src/session/prompt"
import { tmpdir } from "../fixture/fixture"

afterEach(() => {
  mock.restore()
})

function stream() {
  return new ReadableStream({
    start(ctrl) {
      ctrl.enqueue({ type: "stream-start", warnings: [] })
      ctrl.enqueue({
        type: "finish",
        finishReason: "stop",
        usage: {
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
        },
      })
      ctrl.close()
    },
  })
}

function text(msg: ModelMessage) {
  if (typeof msg.content === "string") return msg.content
  if (!Array.isArray(msg.content)) return ""
  return msg.content.filter((part) => part.type === "text").map((part) => part.text).join("\n")
}

describe("session.llm gitlab workflow", () => {
  test("routes opencode system text through workflow context", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(
          path.join(dir, "opencode.json"),
          JSON.stringify({
            $schema: "https://opencode.ai/config.json",
            enabled_providers: ["gitlab"],
          }),
        )
      },
    })

    await Instance.provide({
      directory: tmp.path,
      init: async () => {
        Env.set("GITLAB_TOKEN", "test-token")
      },
      fn: async () => {
        const providers = await Provider.list()
        const gitlab = providers[ProviderID.make("gitlab")]
        gitlab.models["duo-workflow-sonnet-4-6"] = {
          id: ModelID.make("duo-workflow-sonnet-4-6"),
          providerID: ProviderID.make("gitlab"),
          name: "Agent Platform (Claude Sonnet 4.6)",
          family: "",
          api: { id: "duo-workflow-sonnet-4-6", url: "https://gitlab.com", npm: "gitlab-ai-provider" },
          status: "active",
          headers: {},
          options: { workflowRef: "claude_sonnet_4_6" },
          cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
          limit: { context: 200000, output: 64000 },
          capabilities: {
            temperature: false,
            reasoning: true,
            attachment: true,
            toolcall: true,
            input: { text: true, audio: false, image: true, video: false, pdf: true },
            output: { text: true, audio: false, image: false, video: false, pdf: false },
            interleaved: false,
          },
          release_date: "",
          variants: {},
        }

        const model = await Provider.getModel(ProviderID.make("gitlab"), ModelID.make("duo-workflow-sonnet-4-6"))
        const sessionID = SessionID.make("session-test-workflow")
        const agent = {
          name: "test",
          mode: "primary",
          options: {},
          permission: [{ permission: "*", pattern: "*", action: "allow" }],
        } satisfies Agent.Info

        const user = {
          id: MessageID.make("user-workflow"),
          sessionID,
          role: "user",
          time: { created: Date.now() },
          agent: agent.name,
          model: { providerID: ProviderID.make("gitlab"), modelID: model.id },
        } satisfies MessageV2.User

        let prompt: ModelMessage[] = []
        spyOn(GitLabWorkflowLanguageModel.prototype, "doStream").mockImplementation(async (opts) => {
          prompt = opts.prompt
          return {
            stream: stream(),
          }
        })

        const result = await LLM.stream({
          user,
          sessionID,
          model,
          agent,
          system: ["workflow note"],
          abort: new AbortController().signal,
          messages: [{ role: "user", content: "Hello" }],
          tools: {},
        })

        for await (const _ of result.fullStream) {
        }

        expect(prompt.some((msg) => msg.role === "system")).toBe(false)
        expect(prompt.some((msg) => msg.role === "assistant" && text(msg).includes("workflow note"))).toBe(true)
        expect(prompt.some((msg) => msg.role === "user" && text(msg) === "Hello")).toBe(true)
      },
    })
  })

  test("keeps plan reminders out of workflow user messages", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(
          path.join(dir, "opencode.json"),
          JSON.stringify({
            $schema: "https://opencode.ai/config.json",
            enabled_providers: ["gitlab"],
          }),
        )
      },
    })

    await Instance.provide({
      directory: tmp.path,
      init: async () => {
        Env.set("GITLAB_TOKEN", "test-token")
      },
      fn: async () => {
        const providers = await Provider.list()
        const gitlab = providers[ProviderID.make("gitlab")]
        gitlab.models["duo-workflow-sonnet-4-6"] = {
          id: ModelID.make("duo-workflow-sonnet-4-6"),
          providerID: ProviderID.make("gitlab"),
          name: "Agent Platform (Claude Sonnet 4.6)",
          family: "",
          api: { id: "duo-workflow-sonnet-4-6", url: "https://gitlab.com", npm: "gitlab-ai-provider" },
          status: "active",
          headers: {},
          options: { workflowRef: "claude_sonnet_4_6" },
          cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
          limit: { context: 200000, output: 64000 },
          capabilities: {
            temperature: false,
            reasoning: true,
            attachment: true,
            toolcall: true,
            input: { text: true, audio: false, image: true, video: false, pdf: true },
            output: { text: true, audio: false, image: false, video: false, pdf: false },
            interleaved: false,
          },
          release_date: "",
          variants: {},
        }

        let prompt: ModelMessage[] = []
        spyOn(GitLabWorkflowLanguageModel.prototype, "doStream").mockImplementation(async (opts) => {
          prompt = opts.prompt
          return {
            stream: stream(),
          }
        })

        const session = await Session.create({})
        await SessionPrompt.prompt({
          sessionID: session.id,
          agent: "plan",
          model: {
            providerID: ProviderID.make("gitlab"),
            modelID: ModelID.make("duo-workflow-sonnet-4-6"),
          },
          parts: [{ type: "text", text: "Draft a plan" }],
        })

        const user = prompt.filter((msg) => msg.role === "user").map(text).join("\n")
        const assistant = prompt.filter((msg) => msg.role === "assistant").map(text).join("\n")
        const note = "The user indicated that they do not want you to execute yet"

        expect(user.includes(note)).toBe(false)
        expect(assistant.includes(note)).toBe(true)
      },
    })
  })
})
