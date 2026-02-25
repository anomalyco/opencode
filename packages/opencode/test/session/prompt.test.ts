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


describe("session.prompt steer", () => {
  test("falls back to a no-reply user message when session is idle", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const result = await SessionPrompt.steer({
          sessionID: session.id,
          text: "please focus on tests next",
        })

        expect(result.accepted).toBe(false)

        const msgs = await Session.messages({ sessionID: session.id })
        const user = msgs.find((msg) => msg.info.role === "user")
        expect(user?.parts.some((part) => part.type === "text" && part.text === "please focus on tests next")).toBe(true)

        await Session.remove(session.id)
      },
    })
  })

  test("drains queued steer messages in timestamp order when session is busy", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const seed = await SessionPrompt.prompt({
          sessionID: session.id,
          noReply: true,
          parts: [{ type: "text", text: "seed" }],
        })
        if (seed.info.role !== "user") throw new Error("expected user message")

        SessionPrompt.testing.startBusy(session.id)

        const now = Date.now
        let idx = 0
        const times = [2001, 1001, 2002, 1003, 2003, 1002]
        Date.now = () => {
          const next = times[idx]
          idx += 1
          return next ?? times[times.length - 1]
        }

        try {
          await SessionPrompt.steer({
            sessionID: session.id,
            text: "first",
          })
          await SessionPrompt.steer({
            sessionID: session.id,
            text: "third",
          })
          await SessionPrompt.steer({
            sessionID: session.id,
            text: "second",
          })
        } finally {
          Date.now = now
        }

        const drained = await SessionPrompt.testing.drainSteer({
          sessionID: session.id,
          user: seed.info,
        })
        expect(drained).toBe(true)

        const msgs = await Session.messages({ sessionID: session.id })
        const parts = msgs
          .filter((msg) => msg.info.role === "user")
          .map((msg) =>
            msg.parts.find(
              (part): part is MessageV2.TextPart =>
                part.type === "text" && part.synthetic === true && part.metadata?.steer === true,
            ),
          )
          .filter((part): part is MessageV2.TextPart => !!part)

        expect(parts.length).toBe(3)
        const timestamps = parts.map((part) => part.metadata?.steer_timestamp)
        expect(timestamps.every((x) => typeof x === "number")).toBe(true)
        expect(parts.map((part) => part.text).toSorted()).toEqual(["first", "second", "third"])

        for (const part of parts) {
          expect(part.synthetic).toBe(true)
          expect(part.metadata).toMatchObject({
            steer: true,
          })
          const data = part.metadata
          expect(typeof data?.steer_id).toBe("string")
          expect(typeof data?.steer_timestamp).toBe("number")
        }

        const empty = await SessionPrompt.testing.drainSteer({
          sessionID: session.id,
          user: seed.info,
        })
        expect(empty).toBe(false)

        SessionPrompt.cancel(session.id)
        await Session.remove(session.id)
      },
    })
  })

  test("persists busy steer immediately and does not duplicate on drain", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const seed = await SessionPrompt.prompt({
          sessionID: session.id,
          noReply: true,
          parts: [{ type: "text", text: "seed" }],
        })
        if (seed.info.role !== "user") throw new Error("expected user message")

        SessionPrompt.testing.startBusy(session.id)

        const first = await SessionPrompt.steer({
          sessionID: session.id,
          text: "focus on tests",
        })
        const second = await SessionPrompt.steer({
          sessionID: session.id,
          text: "only touch prompt code",
        })

        expect(first.accepted).toBe(true)
        expect(second.accepted).toBe(true)

        const steerParts = async () =>
          (await Session.messages({ sessionID: session.id }))
            .flatMap((msg) => msg.parts)
            .filter(
              (part): part is MessageV2.TextPart =>
                part.type === "text" && part.synthetic === true && part.metadata?.steer === true,
            )

        const beforeDrain = await steerParts()
        expect(beforeDrain.map((part) => part.text).toSorted()).toEqual(["focus on tests", "only touch prompt code"])

        const drained = await SessionPrompt.testing.drainSteer({
          sessionID: session.id,
          user: seed.info,
        })
        expect(drained).toBe(true)

        const afterDrain = await steerParts()
        expect(afterDrain.length).toBe(beforeDrain.length)
        expect(afterDrain.map((part) => part.text).toSorted()).toEqual(["focus on tests", "only touch prompt code"])

        SessionPrompt.cancel(session.id)
        await Session.remove(session.id)
      },
    })
  })

  test("draining steer queue is a no-op when no steer is queued", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const seed = await SessionPrompt.prompt({
          sessionID: session.id,
          noReply: true,
          parts: [{ type: "text", text: "seed" }],
        })
        if (seed.info.role !== "user") throw new Error("expected user message")

        SessionPrompt.testing.startBusy(session.id)
        const before = (await Session.messages({ sessionID: session.id })).length

        const drained = await SessionPrompt.testing.drainSteer({
          sessionID: session.id,
          user: seed.info,
        })
        expect(drained).toBe(false)

        const after = (await Session.messages({ sessionID: session.id })).length
        expect(after).toBe(before)

        SessionPrompt.cancel(session.id)
        await Session.remove(session.id)
      },
    })
  })
})
