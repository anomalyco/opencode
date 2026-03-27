import { afterEach, describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { SessionPrompt } from "../../src/session/prompt"
import { tmpdir } from "../fixture/fixture"

const env = {
  HOME: process.env.HOME,
  OPENCODE_TEST_HOME: process.env.OPENCODE_TEST_HOME,
  SHELL: process.env.SHELL,
}

afterEach(() => {
  if (env.HOME === undefined) delete process.env.HOME
  else process.env.HOME = env.HOME
  if (env.OPENCODE_TEST_HOME === undefined) delete process.env.OPENCODE_TEST_HOME
  else process.env.OPENCODE_TEST_HOME = env.OPENCODE_TEST_HOME
  if (env.SHELL === undefined) delete process.env.SHELL
  else process.env.SHELL = env.SHELL
})

describe("session.prompt sandbox", () => {
  test("keeps shell startup deterministic in sandbox mode", async () => {
    if (process.platform !== "darwin") return
    await using home = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, ".zshenv"), "export OPENCODE_ZSHENV_HIT=1\n")
      },
    })
    await using tmp = await tmpdir({
      config: {
        experimental: {
          sandbox: {
            enabled: true,
          },
        },
        agent: {
          build: {
            model: "openai/gpt-5.2",
          },
        },
      },
    })
    process.env.HOME = home.path
    process.env.OPENCODE_TEST_HOME = home.path
    process.env.SHELL = "/bin/zsh"

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const out = await SessionPrompt.shell({
          sessionID: session.id,
          agent: "build",
          command: "printf '%s' \"${OPENCODE_ZSHENV_HIT:-missing}\"",
        })
        const part = out.parts[0]
        if (part.type !== "tool") throw new Error("expected tool part")
        if (part.state.status !== "completed") throw new Error("expected completed part")
        expect(part.state.output).toBe("missing")
        await Session.remove(session.id)
      },
    })
  })

  test("denies sensitive home reads and preserves abort behavior", async () => {
    if (process.platform !== "darwin") return
    await using home = await tmpdir({
      init: async (dir) => {
        await fs.mkdir(path.join(dir, ".ssh"), { recursive: true })
        await Bun.write(path.join(dir, ".ssh", "secret"), "secret\n")
      },
    })
    await using tmp = await tmpdir({
      config: {
        experimental: {
          sandbox: {
            enabled: true,
          },
        },
        agent: {
          build: {
            model: "openai/gpt-5.2",
          },
        },
      },
    })
    process.env.HOME = home.path
    process.env.OPENCODE_TEST_HOME = home.path
    process.env.SHELL = "/bin/zsh"

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const denied = await SessionPrompt.shell({
          sessionID: session.id,
          agent: "build",
          command: 'cat "$HOME/.ssh/secret"',
        })
        const blocked = denied.parts[0]
        if (blocked.type !== "tool") throw new Error("expected tool part")
        if (blocked.state.status !== "completed") throw new Error("expected completed part")
        expect(blocked.state.output).not.toContain("secret\n")
        expect(blocked.state.output).toContain("Operation not permitted")

        const next = await Session.create({})
        const run = SessionPrompt.shell({
          sessionID: next.id,
          agent: "build",
          command: "sleep 5",
        })
        setTimeout(() => {
          void SessionPrompt.cancel(next.id)
        }, 50)
        const out = await run
        const part = out.parts[0]
        if (part.type !== "tool") throw new Error("expected tool part")
        if (part.state.status !== "completed") throw new Error("expected completed part")
        expect(part.state.output).toContain("User aborted the command")

        await Session.remove(session.id)
        await Session.remove(next.id)
      },
    })
  })
})
