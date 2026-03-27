import { afterEach, describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { BashTool } from "../../src/tool/bash"
import { Instance } from "../../src/project/instance"
import { SessionID, MessageID } from "../../src/session/schema"
import { tmpdir } from "../fixture/fixture"

const env = {
  HOME: process.env.HOME,
  OPENCODE_TEST_HOME: process.env.OPENCODE_TEST_HOME,
  SHELL: process.env.SHELL,
}

const ctx = {
  sessionID: SessionID.make("ses_test"),
  messageID: MessageID.make(""),
  callID: "",
  agent: "build",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => {},
  ask: async () => {},
}

afterEach(() => {
  if (env.HOME === undefined) delete process.env.HOME
  else process.env.HOME = env.HOME
  if (env.OPENCODE_TEST_HOME === undefined) delete process.env.OPENCODE_TEST_HOME
  else process.env.OPENCODE_TEST_HOME = env.OPENCODE_TEST_HOME
  if (env.SHELL === undefined) delete process.env.SHELL
  else process.env.SHELL = env.SHELL
})

describe("tool.bash sandbox", () => {
  test("allows in-project writes and skips zsh startup files in sandbox mode", async () => {
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
      },
    })
    process.env.HOME = home.path
    process.env.OPENCODE_TEST_HOME = home.path
    process.env.SHELL = "/bin/zsh"

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const bash = await BashTool.init()
        const out = await bash.execute(
          {
            command: "printf '%s\n' \"${OPENCODE_ZSHENV_HIT:-missing}\" && printf 'ok' > hit.txt && cat hit.txt",
            description: "Writes inside sandbox",
          },
          ctx,
        )
        expect(out.metadata.exit).toBe(0)
        expect(out.output).toContain("missing")
        expect(out.output).toContain("ok")
      },
    })
  })

  test("denies reads from sensitive home paths", async () => {
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
      },
    })
    process.env.HOME = home.path
    process.env.OPENCODE_TEST_HOME = home.path
    process.env.SHELL = "/bin/zsh"

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const bash = await BashTool.init()
        const out = await bash.execute(
          {
            command: 'cat "$HOME/.ssh/secret"',
            description: "Reads blocked home file",
          },
          ctx,
        )
        expect(out.output).not.toContain("secret\n")
        expect(out.output).toContain("Operation not permitted")
      },
    })
  })

  test("preserves timeout and abort through the sandbox wrapper", async () => {
    if (process.platform !== "darwin") return
    await using home = await tmpdir()
    await using tmp = await tmpdir({
      config: {
        experimental: {
          sandbox: {
            enabled: true,
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
        const bash = await BashTool.init()
        const slow = await bash.execute(
          {
            command: "sleep 2",
            timeout: 50,
            description: "Times out in sandbox",
          },
          ctx,
        )
        expect(slow.output).toContain("terminated command after exceeding timeout")

        const abort = new AbortController()
        const run = bash.execute(
          {
            command: "sleep 5",
            description: "Aborts in sandbox",
          },
          { ...ctx, abort: abort.signal },
        )
        setTimeout(() => abort.abort(), 50)
        const out = await run
        expect(out.output).toContain("User aborted the command")
      },
    })
  })
})
