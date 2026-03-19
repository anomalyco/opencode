import path from "path"
import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test"
import { fileURLToPath } from "url"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { MessageV2 } from "../../src/session/message-v2"
import { SessionPrompt } from "../../src/session/prompt"
import * as LLMModule from "../../src/session/llm"
import { Log } from "../../src/util/log"
import { tmpdir } from "../fixture/fixture"

Log.init({ print: false })

type MockStreamInput = Parameters<typeof LLMModule.LLM.stream>[0]

const usage = {
  inputTokens: 10,
  outputTokens: 4,
  totalTokens: 14,
  reasoningTokens: 0,
  cachedInputTokens: 0,
}

describe("session.prompt missing file", () => {
  test("does not fail the prompt when a file part is missing", async () => {
    await using tmp = await tmpdir({
      git: true,
      config: {
        agent: {
          build: {
            model: "openai/gpt-5.2",
          },
        },
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})

        const missing = path.join(tmp.path, "does-not-exist.ts")
        const msg = await SessionPrompt.prompt({
          sessionID: session.id,
          agent: "build",
          noReply: true,
          parts: [
            { type: "text", text: "please review @does-not-exist.ts" },
            {
              type: "file",
              mime: "text/plain",
              url: `file://${missing}`,
              filename: "does-not-exist.ts",
            },
          ],
        })

        if (msg.info.role !== "user") throw new Error("expected user message")

        const hasFailure = msg.parts.some(
          (part) => part.type === "text" && part.synthetic && part.text.includes("Read tool failed to read"),
        )
        expect(hasFailure).toBe(true)

        await Session.remove(session.id)
      },
    })
  })

  test("keeps stored part order stable when file resolution is async", async () => {
    await using tmp = await tmpdir({
      git: true,
      config: {
        agent: {
          build: {
            model: "openai/gpt-5.2",
          },
        },
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})

        const missing = path.join(tmp.path, "still-missing.ts")
        const msg = await SessionPrompt.prompt({
          sessionID: session.id,
          agent: "build",
          noReply: true,
          parts: [
            {
              type: "file",
              mime: "text/plain",
              url: `file://${missing}`,
              filename: "still-missing.ts",
            },
            { type: "text", text: "after-file" },
          ],
        })

        if (msg.info.role !== "user") throw new Error("expected user message")

        const stored = await MessageV2.get({
          sessionID: session.id,
          messageID: msg.info.id,
        })
        const text = stored.parts.filter((part) => part.type === "text").map((part) => part.text)

        expect(text[0]?.startsWith("Called the Read tool with the following input:")).toBe(true)
        expect(text[1]?.includes("Read tool failed to read")).toBe(true)
        expect(text[2]).toBe("after-file")

        await Session.remove(session.id)
      },
    })
  })
})

describe("session.prompt max steps", () => {
  let streamSpy: ReturnType<typeof spyOn>
  let previousOpenAIKey: string | undefined

  function hasWrapUpPrompt(input: MockStreamInput) {
    return input.messages.some(
      (message: MockStreamInput["messages"][number]) =>
        message.role === "assistant" &&
        typeof message.content === "string" &&
        message.content.includes("Tools are disabled until next user input"),
    )
  }

  beforeEach(() => {
    previousOpenAIKey = process.env.OPENAI_API_KEY
    process.env.OPENAI_API_KEY = "test-openai-key"
    streamSpy = spyOn(LLMModule.LLM, "stream")
  })

  afterEach(() => {
    streamSpy.mockRestore()
    if (previousOpenAIKey === undefined) delete process.env.OPENAI_API_KEY
    else process.env.OPENAI_API_KEY = previousOpenAIKey
  })

  test("injects the max-steps wrap-up prompt by default", async () => {
    streamSpy.mockImplementationOnce(async (input: MockStreamInput) => {
      expect(hasWrapUpPrompt(input)).toBe(true)

      return ({
        fullStream: (async function* () {
          yield { type: "start-step" as const }
          yield { type: "text-start" as const }
          yield { type: "text-delta" as const, text: "Wrapped up." }
          yield { type: "text-end" as const }
          yield {
            type: "finish-step" as const,
            finishReason: "stop",
            usage,
            providerMetadata: {},
          }
        })(),
      } as unknown) as Awaited<ReturnType<typeof LLMModule.LLM.stream>>
    })

    await using tmp = await tmpdir({
      git: true,
      config: {
        agent: {
          build: {
            model: "openai/gpt-5.2",
            steps: 1,
          },
        },
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({ title: "Max steps default" })
        const result = await SessionPrompt.prompt({
          sessionID: session.id,
          agent: "build",
          parts: [{ type: "text", text: "Do one step and stop." }],
        })

        expect(streamSpy).toHaveBeenCalledTimes(1)
        expect(result.info.role).toBe("assistant")
        if (result.info.role === "assistant") {
          expect(result.info.finish).toBe("stop")
        }
      },
    })
  })

  test("stops immediately at the step limit when stopOnMaxSteps is enabled", async () => {
    streamSpy.mockImplementation(async (input: MockStreamInput) => {
      expect(hasWrapUpPrompt(input)).toBe(false)

      return ({
        fullStream: (async function* () {
          yield { type: "start-step" as const }
          yield {
            type: "finish-step" as const,
            finishReason: "tool-calls",
            usage,
            providerMetadata: {},
          }
        })(),
      } as unknown) as Awaited<ReturnType<typeof LLMModule.LLM.stream>>
    })

    await using tmp = await tmpdir({
      git: true,
      config: {
        agent: {
          build: {
            model: "openai/gpt-5.2",
            steps: 1,
            stopOnMaxSteps: true,
          },
        },
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({ title: "Max steps hard stop" })
        const result = await SessionPrompt.prompt({
          sessionID: session.id,
          agent: "build",
          parts: [{ type: "text", text: "Do one step and hard stop." }],
        })

        expect(streamSpy).toHaveBeenCalledTimes(1)
        expect(result.info.role).toBe("assistant")
        if (result.info.role === "assistant") {
          expect(result.info.finish).toBe("step-limit")
        }
        expect(result.parts.some((part) => part.type === "step-finish")).toBe(true)
      },
    })
  }, 10000)
})

describe("session.prompt special characters", () => {
  test("handles filenames with # character", async () => {
    await using tmp = await tmpdir({
      git: true,
      init: async (dir) => {
        await Bun.write(path.join(dir, "file#name.txt"), "special content\n")
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const template = "Read @file#name.txt"
        const parts = await SessionPrompt.resolvePromptParts(template)
        const fileParts = parts.filter((part) => part.type === "file")

        expect(fileParts.length).toBe(1)
        expect(fileParts[0].filename).toBe("file#name.txt")
        expect(fileParts[0].url).toContain("%23")

        const decodedPath = fileURLToPath(fileParts[0].url)
        expect(decodedPath).toBe(path.join(tmp.path, "file#name.txt"))

        const message = await SessionPrompt.prompt({
          sessionID: session.id,
          parts,
          noReply: true,
        })
        const stored = await MessageV2.get({ sessionID: session.id, messageID: message.info.id })
        const textParts = stored.parts.filter((part) => part.type === "text")
        const hasContent = textParts.some((part) => part.text.includes("special content"))
        expect(hasContent).toBe(true)

        await Session.remove(session.id)
      },
    })
  })
})

describe("session.prompt agent variant", () => {
  test("applies agent variant only when using agent model", async () => {
    const prev = process.env.OPENAI_API_KEY
    process.env.OPENAI_API_KEY = "test-openai-key"

    try {
      await using tmp = await tmpdir({
        git: true,
        config: {
          agent: {
            build: {
              model: "openai/gpt-5.2",
              variant: "xhigh",
            },
          },
        },
      })

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const session = await Session.create({})

          const other = await SessionPrompt.prompt({
            sessionID: session.id,
            agent: "build",
            model: { providerID: "opencode", modelID: "kimi-k2.5-free" },
            noReply: true,
            parts: [{ type: "text", text: "hello" }],
          })
          if (other.info.role !== "user") throw new Error("expected user message")
          expect(other.info.variant).toBeUndefined()

          const match = await SessionPrompt.prompt({
            sessionID: session.id,
            agent: "build",
            noReply: true,
            parts: [{ type: "text", text: "hello again" }],
          })
          if (match.info.role !== "user") throw new Error("expected user message")
          expect(match.info.model).toEqual({ providerID: "openai", modelID: "gpt-5.2" })
          expect(match.info.variant).toBe("xhigh")

          const override = await SessionPrompt.prompt({
            sessionID: session.id,
            agent: "build",
            noReply: true,
            variant: "high",
            parts: [{ type: "text", text: "hello third" }],
          })
          if (override.info.role !== "user") throw new Error("expected user message")
          expect(override.info.variant).toBe("high")

          await Session.remove(session.id)
        },
      })
    } finally {
      if (prev === undefined) delete process.env.OPENAI_API_KEY
      else process.env.OPENAI_API_KEY = prev
    }
  })
})
