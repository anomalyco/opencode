import { afterEach, describe, expect, spyOn, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { BashTool } from "../../src/tool/bash"
import { SandboxRuntime } from "../../src/sandbox/runtime"
import { Tool } from "../../src/tool/tool"
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

const makeCtx = (ask: Tool.Context["ask"] = async () => {}) => ({
  ...ctx,
  ask,
})

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
        const seen: string[] = []
        const bash = await BashTool.init()
        const out = await bash.execute(
          {
            command: 'cat "$HOME/.ssh/secret"',
            description: "Reads blocked home file",
          },
          makeCtx(async (req) => {
            seen.push(req.permission)
          }),
        )
        expect(out.output).not.toContain("secret\n")
        expect(out.output).toContain("Operation not permitted")
        expect(seen).not.toContain("bash:unsandboxed")
      },
    })
  })

  test("denies in-project writes in read-only mode", async () => {
    if (process.platform !== "darwin") return
    await using home = await tmpdir()
    await using tmp = await tmpdir({
      config: {
        experimental: {
          sandbox: {
            enabled: true,
            mode: "read-only",
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
            command: "printf 'ok' > hit.txt",
            description: "Writes in read-only sandbox",
          },
          ctx,
        )
        expect(out.output).toContain("operation not permitted")
        expect(await fs.stat(path.join(tmp.path, "hit.txt")).catch(() => undefined)).toBeUndefined()
      },
    })
  })

  test("allows tmp writes in read-only mode", async () => {
    if (process.platform !== "darwin") return
    await using home = await tmpdir()
    await using tmp = await tmpdir({
      config: {
        experimental: {
          sandbox: {
            enabled: true,
            mode: "read-only",
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
        const file = path.join("/tmp", `opencode-sandbox-${Date.now()}.txt`)
        const bash = await BashTool.init()
        const out = await bash.execute(
          {
            command: `printf 'ok' > ${JSON.stringify(file)} && cat ${JSON.stringify(file)} && rm ${JSON.stringify(file)}`,
            description: "Writes tmp file in read-only sandbox",
          },
          ctx,
        )
        expect(out.output).toContain("ok")
      },
    })
  })

  test("blocks excluded commands before execution", async () => {
    await using tmp = await tmpdir({
      config: {
        experimental: {
          sandbox: {
            enabled: true,
            excluded_commands: ["rm"],
          },
        },
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const seen: string[] = []
        const bash = await BashTool.init()
        await expect(
          bash.execute(
            {
              command: "rm -rf /tmp/test",
              description: "Blocked command",
            },
            makeCtx(async (req) => {
              seen.push(req.permission)
            }),
          ),
        ).rejects.toThrow("rm")
        expect(seen).toEqual([])
      },
    })
  })

  test("retries unsandboxed when allowed and approved", async () => {
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
            allow_unsandboxed_retry: true,
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
        const seen: string[] = []
        const bash = await BashTool.init()
        const out = await bash.execute(
          {
            command: 'cat "$HOME/.ssh/secret"',
            description: "Retries without sandbox",
          },
          makeCtx(async (req) => {
            seen.push(req.permission)
          }),
        )
        expect(seen).toContain("bash:unsandboxed")
        expect(out.output).toContain("secret\n")
        expect(out.output).toContain("Retried command without sandbox")
      },
    })
  })

  test("runs unsandboxed on the first attempt after an explicit request", async () => {
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
            allow_unsandboxed_retry: true,
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
        const seen: string[] = []
        const bash = await BashTool.init()
        const out = await bash.execute(
          {
            command: '# opencode:unsandboxed needs secret access\ncat "$HOME/.ssh/secret"',
            description: "Requests unsandboxed first attempt",
          },
          makeCtx(async (req) => {
            seen.push(req.permission)
          }),
        )
        expect(seen).toContain("bash:unsandboxed")
        expect(out.output).toContain("secret\n")
        expect(out.output).not.toContain("Retried command without sandbox")
      },
    })
  })

  test("keeps the original denial when unsandboxed retry is rejected", async () => {
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
            allow_unsandboxed_retry: true,
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
        const seen: string[] = []
        const bash = await BashTool.init()
        const out = await bash.execute(
          {
            command: 'cat "$HOME/.ssh/secret"',
            description: "Rejects unsandboxed retry",
          },
          makeCtx(async (req) => {
            seen.push(req.permission)
            if (req.permission === "bash:unsandboxed") throw new Error("reject")
          }),
        )
        expect(seen).toContain("bash:unsandboxed")
        expect(out.output).not.toContain("secret\n")
        expect(out.output).toContain("Operation not permitted")
      },
    })
  })

  test("falls back to sandboxed execution when an explicit request is rejected", async () => {
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
            allow_unsandboxed_retry: true,
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
        const seen: string[] = []
        const bash = await BashTool.init()
        const out = await bash.execute(
          {
            command: '# opencode:unsandboxed needs secret access\ncat "$HOME/.ssh/secret"',
            description: "Rejects proactive unsandboxed request",
          },
          makeCtx(async (req) => {
            seen.push(req.permission)
            if (req.permission === "bash:unsandboxed") throw new Error("reject")
          }),
        )
        expect(seen.filter((item) => item === "bash:unsandboxed")).toEqual(["bash:unsandboxed"])
        expect(out.output).not.toContain("secret\n")
        expect(out.output).toContain("Operation not permitted")
        expect(out.output).toContain("Explicit unsandboxed request was rejected; command ran in sandbox")
      },
    })
  })

  test("reports sandboxed fallback launch failures after explicit rejection", async () => {
    if (process.platform !== "darwin") return
    const plan = spyOn(SandboxRuntime, "plan").mockResolvedValue({
      active: true,
      file: "/definitely/missing-sandbox-exec",
      args: [],
      diag: {
        requested: true,
        active: true,
        reason: "enabled",
        wrapper: "/usr/bin/sandbox-exec",
        cwd: "/tmp/project",
        mode: "workspace-write",
        read_roots: [],
        write_roots: [],
        unsafe_roots: [],
        allow_network: false,
        allow_unix_sockets: false,
      },
    })
    try {
      await using tmp = await tmpdir({
        config: {
          experimental: {
            sandbox: {
              enabled: true,
              allow_unsandboxed_retry: true,
            },
          },
        },
      })
      process.env.SHELL = "/bin/zsh"

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const bash = await BashTool.init()
          await expect(
            bash.execute(
              {
                command: "# opencode:unsandboxed needs network\nwget google.com",
                description: "Rejects proactive unsandboxed request before spawn",
              },
              makeCtx(async (req) => {
                if (req.permission === "bash:unsandboxed") throw new Error("reject")
              }),
            ),
          ).rejects.toThrow("Explicit unsandboxed request was rejected; sandboxed fallback failed before command start")
        },
      })
    } finally {
      plan.mockRestore()
    }
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
