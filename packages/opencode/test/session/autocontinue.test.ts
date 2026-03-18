import { describe, expect, mock, test } from "bun:test"
import path from "path"
import { Filesystem } from "../../src/util/filesystem"
import { tmpdir } from "../fixture/fixture"

const calls: unknown[] = []

mock.module("../../src/session/prompt", () => ({
  SessionPrompt: {
    prompt(input: unknown) {
      calls.push(input)
      return Promise.resolve(undefined)
    },
  },
}))

describe("AutoContinue", () => {
  test("matches the closing paragraph", async () => {
    const { AutoContinue } = await import("../../src/session/autocontinue")
    expect(
      AutoContinue.match("If you'd like, I can continue from here.", {
        enabled: true,
        prompt: "Yes. Do this.",
        patterns: ["\\bif you(?:'d| would)? like\\b"],
      }),
    ).toBe(true)
    expect(
      AutoContinue.tail([
        {
          id: "part_1",
          messageID: "message_1",
          sessionID: "session_1",
          type: "text",
          text: "Finished step 2.\n\nIf you'd like, I can continue.",
        },
      ]),
    ).toBe("If you'd like, I can continue.")
  })

  test("submits one synthetic follow-up for matching assistant replies", async () => {
    calls.length = 0
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Filesystem.write(
          path.join(dir, "opencode.json"),
          JSON.stringify({
            experimental: {
              auto_continue: true,
            },
          }),
        )
      },
    })
    const [{ Instance }, { Session }, { Identifier }, { AutoContinue }] = await Promise.all([
      import("../../src/project/instance"),
      import("../../src/session"),
      import("../../src/id/id"),
      import("../../src/session/autocontinue"),
    ])

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        AutoContinue.init()

        const session = await Session.create({})
        const user = Identifier.ascending("message")
        const aid = Identifier.ascending("message")

        await Session.updateMessage({
          id: user,
          sessionID: session.id,
          role: "user",
          time: { created: Date.now() },
          agent: "build",
          model: { providerID: "test", modelID: "test" },
        } as any)

        await Session.updateMessage({
          id: aid,
          parentID: user,
          sessionID: session.id,
          role: "assistant",
          mode: "build",
          agent: "build",
          path: { cwd: tmp.path, root: tmp.path },
          cost: 0,
          tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          modelID: "test",
          providerID: "test",
          time: { created: Date.now() },
        } as any)
        await Session.updatePart({
          id: Identifier.ascending("part"),
          messageID: aid,
          sessionID: session.id,
          type: "text",
          text: "I finished step 2 of 11. If you'd like, I can continue.",
        } as any)
        await Session.updateMessage({
          id: aid,
          parentID: user,
          sessionID: session.id,
          role: "assistant",
          mode: "build",
          agent: "build",
          path: { cwd: tmp.path, root: tmp.path },
          cost: 0,
          tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          modelID: "test",
          providerID: "test",
          finish: "stop",
          time: { created: Date.now(), completed: Date.now() },
        } as any)
        await Session.updateMessage({
          id: aid,
          parentID: user,
          sessionID: session.id,
          role: "assistant",
          mode: "build",
          agent: "build",
          path: { cwd: tmp.path, root: tmp.path },
          cost: 0,
          tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          modelID: "test",
          providerID: "test",
          finish: "stop",
          time: { created: Date.now(), completed: Date.now() },
        } as any)

        await new Promise((resolve) => setTimeout(resolve, 50))

        expect(calls).toHaveLength(1)
        expect(calls[0]).toMatchObject({
          sessionID: session.id,
          parts: [
            {
              type: "text",
              text: "Yes. Do this.",
              synthetic: true,
            },
          ],
        })
      },
    })
  })
})
