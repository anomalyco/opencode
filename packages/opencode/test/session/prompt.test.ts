import path from "path"
import { describe, expect, test } from "bun:test"
import { fileURLToPath } from "url"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { MessageV2 } from "../../src/session/message-v2"
import { SessionPrompt } from "../../src/session/prompt"
import { Log } from "../../src/util/log"
import { tmpdir } from "../fixture/fixture"

Log.init({ print: false })

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

describe("session.prompt continuation turns", () => {
  test("appends a synthetic user turn for Copilot Claude when the loop would continue after an assistant turn", () => {
    const userInfo: MessageV2.User = {
      id: "msg_user",
      sessionID: "ses_test",
      role: "user",
      time: { created: 1 },
      agent: "build",
      model: { providerID: "github-copilot", modelID: "claude-opus-4.6" },
    }
    const assistantInfo: MessageV2.Assistant = {
      id: "msg_assistant",
      sessionID: "ses_test",
      role: "assistant",
      time: { created: 2, completed: 3 },
      parentID: "msg_user",
      modelID: "claude-opus-4.6",
      providerID: "github-copilot",
      mode: "build",
      agent: "build",
      path: { cwd: "/tmp", root: "/tmp" },
      cost: 0,
      tokens: {
        input: 0,
        output: 0,
        reasoning: 0,
        cache: { read: 0, write: 0 },
      },
      finish: "tool-calls",
    }
    const messages: MessageV2.WithParts[] = [
      {
        info: userInfo,
        parts: [
          {
            id: "prt_user",
            messageID: "msg_user",
            sessionID: "ses_test",
            type: "text",
            text: "Continue.",
          },
        ],
      },
      {
        info: assistantInfo,
        parts: [
          {
            id: "prt_assistant",
            messageID: "msg_assistant",
            sessionID: "ses_test",
            type: "text",
            text: "It's running. Let me check again.",
          },
        ],
      },
    ]

    const result = SessionPrompt.appendSyntheticContinuationTurn(messages, userInfo, {
      id: "claude-opus-4.6",
      api: { npm: "@ai-sdk/github-copilot" },
    } as any)

    expect(result).toHaveLength(3)
    expect(result[2].info.role).toBe("user")
    expect(result[2].parts).toHaveLength(1)
    expect(result[2].parts[0].type).toBe("text")
    expect("synthetic" in result[2].parts[0] && result[2].parts[0].synthetic).toBe(true)
    expect(result[2].parts[0].type === "text" && result[2].parts[0].text).toContain(
      "Continue with your task using the conversation and tool results above.",
    )
  })

  test("appends the max-step reminder to the trailing user turn when forcing a user-final prompt", () => {
    const userInfo: MessageV2.User = {
      id: "msg_user",
      sessionID: "ses_test",
      role: "user",
      time: { created: 1 },
      agent: "build",
      model: { providerID: "github-copilot", modelID: "claude-opus-4.6" },
    }
    const messages: MessageV2.WithParts[] = [
      {
        info: userInfo,
        parts: [
          {
            id: "prt_user",
            messageID: "msg_user",
            sessionID: "ses_test",
            type: "text",
            text: "Continue.",
          },
        ],
      },
    ]

    const result = SessionPrompt.appendSyntheticContinuationTurn(
      messages,
      userInfo,
      {
        id: "claude-opus-4.6",
        api: { npm: "@ai-sdk/github-copilot" },
      } as any,
      {
        forceFinalUser: true,
        text: "<system-reminder>\nCRITICAL - MAXIMUM STEPS REACHED\n</system-reminder>",
      },
    )

    expect(result).toHaveLength(1)
    expect(result[0].info.role).toBe("user")
    expect(result[0].parts).toHaveLength(2)
    expect(result[0].parts[1].type).toBe("text")
    expect("synthetic" in result[0].parts[1] && result[0].parts[1].synthetic).toBe(true)
    expect(result[0].parts[1].type === "text" && result[0].parts[1].text).toContain("MAXIMUM STEPS REACHED")
  })

  test("does not append a synthetic user turn for providers that allow assistant-final turns", () => {
    const userInfo: MessageV2.User = {
      id: "msg_user",
      sessionID: "ses_test",
      role: "user",
      time: { created: 1 },
      agent: "build",
      model: { providerID: "openai", modelID: "gpt-5.2" },
    }
    const assistantInfo: MessageV2.Assistant = {
      id: "msg_assistant",
      sessionID: "ses_test",
      role: "assistant",
      time: { created: 2, completed: 3 },
      parentID: "msg_user",
      modelID: "gpt-5.2",
      providerID: "openai",
      mode: "build",
      agent: "build",
      path: { cwd: "/tmp", root: "/tmp" },
      cost: 0,
      tokens: {
        input: 0,
        output: 0,
        reasoning: 0,
        cache: { read: 0, write: 0 },
      },
      finish: "tool-calls",
    }
    const messages: MessageV2.WithParts[] = [
      {
        info: userInfo,
        parts: [
          {
            id: "prt_user",
            messageID: "msg_user",
            sessionID: "ses_test",
            type: "text",
            text: "Continue.",
          },
        ],
      },
      {
        info: assistantInfo,
        parts: [
          {
            id: "prt_assistant",
            messageID: "msg_assistant",
            sessionID: "ses_test",
            type: "text",
            text: "Working on it.",
          },
        ],
      },
    ]

    const result = SessionPrompt.appendSyntheticContinuationTurn(messages, userInfo, {
      id: "gpt-5.2",
      api: { npm: "@ai-sdk/openai" },
    } as any)

    expect(result).toStrictEqual(messages)
  })
})
