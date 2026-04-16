import { afterEach, describe, expect, spyOn, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { AppRuntime } from "../../src/effect/app-runtime"
import { Permission } from "../../src/permission"
import { Instance } from "../../src/project/instance"
import { SandboxSpawn } from "../../src/sandbox/spawn"
import { Session } from "../../src/session"
import { SessionPrompt } from "../../src/session/prompt"
import { tmpdir } from "../fixture/fixture"

const env = {
  HOME: process.env.HOME,
  OPENCODE_TEST_HOME: process.env.OPENCODE_TEST_HOME,
  SHELL: process.env.SHELL,
}

function listPermissions() {
  return AppRuntime.runPromise(Permission.Service.use((svc) => svc.list()))
}

function replyPermission(input: Permission.ReplyInput) {
  return AppRuntime.runPromise(Permission.Service.use((svc) => svc.reply(input)))
}

function createSession() {
  return AppRuntime.runPromise(Session.Service.use((svc) => svc.create({})))
}

function removeSession(id: Session.Info["id"]) {
  return AppRuntime.runPromise(Session.Service.use((svc) => svc.remove(id)))
}

function runShell(input: SessionPrompt.ShellInput) {
  return AppRuntime.runPromise(SessionPrompt.Service.use((svc) => svc.shell(input)))
}

function cancelShell(sessionID: Session.Info["id"]) {
  return AppRuntime.runPromise(SessionPrompt.Service.use((svc) => svc.cancel(sessionID)))
}

async function waitForPending(count: number) {
  for (let i = 0; i < 100; i++) {
    const list = await listPermissions()
    if (list.length === count) return list
    await Bun.sleep(10)
  }
  return listPermissions()
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
      git: true,
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
        const session = await createSession()
        const out = await runShell({
          sessionID: session.id,
          agent: "build",
          command: "printf '%s' \"${OPENCODE_ZSHENV_HIT:-missing}\"",
        })
        const part = out.parts[0]
        if (part.type !== "tool") throw new Error("expected tool part")
        if (part.state.status !== "completed") throw new Error("expected completed part")
        expect(part.state.output).toBe("missing")
        await removeSession(session.id)
      },
    })
  })

  test("denies sensitive home reads and preserves abort behavior", async () => {
    if (process.platform !== "darwin") return
    await using home = await tmpdir({
      init: async (dir) => {
        await fs.mkdir(path.join(dir, ".ssh"), { recursive: true })
        await Bun.write(path.join(dir, ".ssh", "secret"), "secret\n")
        await Bun.write(path.join(dir, ".zshenv"), "export OPENCODE_ZSHENV_HIT=1\n")
      },
    })
    await using tmp = await tmpdir({
      git: true,
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
        const session = await createSession()
        const denied = await runShell({
          sessionID: session.id,
          agent: "build",
          command: 'cat "$HOME/.ssh/secret"',
        })
        const blocked = denied.parts[0]
        if (blocked.type !== "tool") throw new Error("expected tool part")
        if (blocked.state.status !== "completed") throw new Error("expected completed part")
        expect(blocked.state.output).not.toContain("secret\n")
        expect(blocked.state.output).toContain("Operation not permitted")

        const next = await createSession()
        const run = runShell({
          sessionID: next.id,
          agent: "build",
          command: "sleep 5",
        })
        setTimeout(() => {
          void cancelShell(next.id)
        }, 50)
        const out = await run
        const part = out.parts[0]
        if (part.type !== "tool") throw new Error("expected tool part")
        if (part.state.status !== "completed") throw new Error("expected completed part")
        expect(part.state.output).toContain("User aborted the command")

        await removeSession(session.id)
        await removeSession(next.id)
      },
    })
  })

  test("blocks excluded commands before spawning", async () => {
    await using tmp = await tmpdir({
      git: true,
      config: {
        experimental: {
          sandbox: {
            enabled: true,
            excluded_commands: ["curl"],
          },
        },
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
        const session = await createSession()
        const out = await runShell({
          sessionID: session.id,
          agent: "build",
          command: "FOO=1 curl https://example.com\necho done",
        })
        const part = out.parts[0]
        if (part.type !== "tool") throw new Error("expected tool part")
        if (part.state.status !== "completed") throw new Error("expected completed part")
        expect(part.state.output).toContain("curl")
        await removeSession(session.id)
      },
    })
  })

  test("retries unsandboxed when permission is pre-allowed", async () => {
    if (process.platform !== "darwin") return
    await using home = await tmpdir({
      init: async (dir) => {
        await fs.mkdir(path.join(dir, ".ssh"), { recursive: true })
        await Bun.write(path.join(dir, ".ssh", "secret"), "secret\n")
      },
    })
    await using tmp = await tmpdir({
      git: true,
      config: {
        experimental: {
          sandbox: {
            enabled: true,
            allow_unsandboxed_retry: true,
          },
        },
        permission: {
          "bash:unsandboxed": "allow",
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
        const session = await createSession()
        const out = await runShell({
          sessionID: session.id,
          agent: "build",
          command: 'cat "$HOME/.ssh/secret"',
        })
        const part = out.parts[0]
        if (part.type !== "tool") throw new Error("expected tool part")
        if (part.state.status !== "completed") throw new Error("expected completed part")
        expect(part.state.output).toContain("secret\n")
        expect(part.state.output).toContain("Retried command without sandbox")
        expect(part.state.output).not.toContain("1\n")
        await removeSession(session.id)
      },
    })
  })

  test("runs unsandboxed on the first attempt after an explicit request", async () => {
    if (process.platform !== "darwin") return
    await using home = await tmpdir({
      init: async (dir) => {
        await fs.mkdir(path.join(dir, ".ssh"), { recursive: true })
        await Bun.write(path.join(dir, ".ssh", "secret"), "secret\n")
        await Bun.write(path.join(dir, ".zshenv"), "export OPENCODE_ZSHENV_HIT=1\n")
      },
    })
    await using tmp = await tmpdir({
      git: true,
      config: {
        experimental: {
          sandbox: {
            enabled: true,
            allow_unsandboxed_retry: true,
          },
        },
        permission: {
          "bash:unsandboxed": "allow",
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
        const session = await createSession()
        const out = await runShell({
          sessionID: session.id,
          agent: "build",
          command: '# opencode:unsandboxed needs secret access\ncat "$HOME/.ssh/secret"',
        })
        const part = out.parts[0]
        if (part.type !== "tool") throw new Error("expected tool part")
        if (part.state.status !== "completed") throw new Error("expected completed part")
        expect(part.state.output).toContain("secret\n")
        expect(part.state.output).not.toContain("Retried command without sandbox")
        expect(part.state.output).not.toContain("1\n")
        await removeSession(session.id)
      },
    })
  })

  test("signals when an explicit unsandboxed request is rejected and the command falls back to sandbox", async () => {
    if (process.platform !== "darwin") return
    await using home = await tmpdir({
      init: async (dir) => {
        await fs.mkdir(path.join(dir, ".ssh"), { recursive: true })
        await Bun.write(path.join(dir, ".ssh", "secret"), "secret\n")
      },
    })
    await using tmp = await tmpdir({
      git: true,
      config: {
        experimental: {
          sandbox: {
            enabled: true,
            allow_unsandboxed_retry: true,
          },
        },
        permission: {
          "bash:unsandboxed": "ask",
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
        const session = await createSession()
        const run = runShell({
          sessionID: session.id,
          agent: "build",
          command: '# opencode:unsandboxed needs secret access\ncat "$HOME/.ssh/secret"',
        })
        const pending = await waitForPending(1)
        expect(pending).toHaveLength(1)
        await replyPermission({
          requestID: pending[0].id,
          reply: "reject",
        })
        const out = await run
        const part = out.parts[0]
        if (part.type !== "tool") throw new Error("expected tool part")
        if (part.state.status !== "completed") throw new Error("expected completed part")
        expect(part.state.output).not.toContain("secret\n")
        expect(part.state.output).toContain("Operation not permitted")
        expect(part.state.output).toContain("Explicit unsandboxed request was rejected; command ran in sandbox")
        await removeSession(session.id)
      },
    })
  })

  test("unsandboxed always-allow reuses generalized pattern across command variants", async () => {
    if (process.platform !== "darwin") return
    await using home = await tmpdir({
      init: async (dir) => {
        await fs.mkdir(path.join(dir, ".ssh"), { recursive: true })
        await Bun.write(path.join(dir, ".ssh", "foo"), "foo-content\n")
        await Bun.write(path.join(dir, ".ssh", "bar"), "bar-content\n")
      },
    })
    await using tmp = await tmpdir({
      git: true,
      config: {
        experimental: {
          sandbox: {
            enabled: true,
            allow_unsandboxed_retry: true,
          },
        },
        permission: {
          "bash:unsandboxed": "ask",
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
        const session = await createSession()

        const run1 = runShell({
          sessionID: session.id,
          agent: "build",
          command: '# opencode:unsandboxed read foo\ncat "$HOME/.ssh/foo"',
        })
        const pending1 = await waitForPending(1)
        expect(pending1).toHaveLength(1)
        expect(pending1[0].permission).toBe("bash:unsandboxed")
        expect(pending1[0].patterns).toEqual(["cat *"])
        expect(pending1[0].always).toEqual(["cat *"])
        await replyPermission({ requestID: pending1[0].id, reply: "always" })
        const out1 = await run1
        const part1 = out1.parts[0]
        if (part1.type !== "tool") throw new Error("expected tool part")
        if (part1.state.status !== "completed") throw new Error("expected completed part")
        expect(part1.state.output).toContain("foo-content")

        const run2 = runShell({
          sessionID: session.id,
          agent: "build",
          command: '# opencode:unsandboxed read bar\ncat "$HOME/.ssh/bar"',
        })
        await Bun.sleep(100)
        const pending2 = await listPermissions()
        expect(pending2).toHaveLength(0)
        const out2 = await run2
        const part2 = out2.parts[0]
        if (part2.type !== "tool") throw new Error("expected tool part")
        if (part2.state.status !== "completed") throw new Error("expected completed part")
        expect(part2.state.output).toContain("bar-content")

        await removeSession(session.id)
      },
    })
  })

  test("unsandboxed always-allow covers multi-command env-prefix variant", async () => {
    if (process.platform !== "darwin") return
    await using home = await tmpdir({
      init: async (dir) => {
        await fs.mkdir(path.join(dir, ".ssh"), { recursive: true })
        await Bun.write(path.join(dir, ".ssh", "a"), "a-content\n")
        await Bun.write(path.join(dir, ".ssh", "b"), "b-content\n")
      },
    })
    await using tmp = await tmpdir({
      git: true,
      config: {
        experimental: {
          sandbox: {
            enabled: true,
            allow_unsandboxed_retry: true,
          },
        },
        permission: {
          "bash:unsandboxed": "ask",
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
        const session = await createSession()

        const run1 = runShell({
          sessionID: session.id,
          agent: "build",
          command: '# opencode:unsandboxed env read\nFOO=1 cat "$HOME/.ssh/a" && echo done',
        })
        const pending1 = await waitForPending(1)
        expect(pending1).toHaveLength(1)
        expect(pending1[0].patterns).toContain("cat *")
        expect(pending1[0].patterns).toContain("echo *")
        await replyPermission({ requestID: pending1[0].id, reply: "always" })
        await run1

        const run2 = runShell({
          sessionID: session.id,
          agent: "build",
          command: '# opencode:unsandboxed env read\nBAR=2 cat "$HOME/.ssh/b" && echo finished',
        })
        await Bun.sleep(100)
        const pending2 = await listPermissions()
        expect(pending2).toHaveLength(0)
        const out2 = await run2
        const part2 = out2.parts[0]
        if (part2.type !== "tool") throw new Error("expected tool part")
        if (part2.state.status !== "completed") throw new Error("expected completed part")
        expect(part2.state.output).toContain("b-content")

        await removeSession(session.id)
      },
    })
  })

  test("signals when explicit rejection is followed by sandboxed launch failure", async () => {
    if (process.platform !== "darwin") return
    const wrap = spyOn(SandboxSpawn, "wrap").mockReturnValue({
      file: "/definitely/missing-sandbox-exec",
      args: [],
    })
    try {
      await using tmp = await tmpdir({
        git: true,
        config: {
          experimental: {
            sandbox: {
              enabled: true,
              allow_unsandboxed_retry: true,
            },
          },
          permission: {
            "bash:unsandboxed": "ask",
          },
          agent: {
            build: {
              model: "openai/gpt-5.2",
            },
          },
        },
      })
      process.env.SHELL = "/bin/zsh"

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const session = await createSession()
          const run = runShell({
            sessionID: session.id,
            agent: "build",
            command: "# opencode:unsandboxed needs network\nwget google.com",
          })
          const pending = await waitForPending(1)
          expect(pending).toHaveLength(1)
          await replyPermission({
            requestID: pending[0].id,
            reply: "reject",
          })
          const out = await run
          const part = out.parts[0]
          if (part.type !== "tool") throw new Error("expected tool part")
          if (part.state.status !== "completed") throw new Error("expected completed part")
          expect(part.state.output).toContain(
            "Explicit unsandboxed request was rejected; sandboxed fallback failed before command start",
          )
          await removeSession(session.id)
        },
      })
    } finally {
      wrap.mockRestore()
    }
  })
})
