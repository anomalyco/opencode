import { afterEach, describe, expect, test } from "bun:test"
import { Instance } from "../../src/project/instance"
import { SandboxSpawn } from "../../src/sandbox/spawn"
import { tmpdir } from "../fixture/fixture"

const home = process.env.HOME
const testHome = process.env.OPENCODE_TEST_HOME

afterEach(() => {
  if (home === undefined) delete process.env.HOME
  else process.env.HOME = home
  if (testHome === undefined) delete process.env.OPENCODE_TEST_HOME
  else process.env.OPENCODE_TEST_HOME = testHome
  delete process.env.OPENCODE_EXPERIMENTAL_SANDBOX
})

describe("sandbox.spawn", () => {
  test("wraps darwin commands with sandbox-exec", () => {
    const out = SandboxSpawn.plan({
      requested: true,
      platform: "darwin",
      available: true,
      cwd: "/tmp/project",
      project_root: "/tmp/project",
      worktree_root: "/tmp/project",
      home: "/Users/tester",
    })
    const cmd = SandboxSpawn.wrap({
      profile: out.profile!,
      file: "/bin/zsh",
      args: ["-f", "-c", "pwd"],
    })

    expect(out.active).toBe(true)
    expect(out.diag.reason).toBe("enabled")
    expect(cmd.file).toBe("/usr/bin/sandbox-exec")
    expect(cmd.args[0]).toBe("-p")
    expect(cmd.args[2]).toBe("/bin/zsh")
  })

  test("keeps non-darwin behavior unchanged", () => {
    const out = SandboxSpawn.plan({
      requested: true,
      platform: "linux",
      available: true,
      cwd: "/tmp/project",
      project_root: "/tmp/project",
      worktree_root: "/tmp/project",
      home: "/Users/tester",
    })

    expect(out.active).toBe(false)
    expect(out.diag.reason).toBe("unsupported_platform")
  })

  test("rejects broad home roots", () => {
    expect(() =>
      SandboxSpawn.plan({
        requested: true,
        platform: "darwin",
        available: true,
        cwd: "/tmp/project",
        project_root: "/tmp/project",
        worktree_root: "/tmp/project",
        home: "/Users/tester",
        extra_read_roots: ["/Users/tester"],
      }),
    ).toThrow("unsafe_root")
  })

  test("respects the env override at runtime", async () => {
    await using home = await tmpdir()
    await using tmp = await tmpdir({
      config: {
        experimental: {
          sandbox: {
            enabled: false,
          },
        },
      },
    })
    process.env.OPENCODE_EXPERIMENTAL_SANDBOX = "true"
    process.env.OPENCODE_TEST_HOME = home.path
    process.env.HOME = home.path

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const out = await SandboxSpawn.resolve({
          cwd: tmp.path,
          project_root: tmp.path,
          worktree_root: tmp.path,
        })
        expect(out.diag.requested).toBe(true)
      },
    })
  })
})
