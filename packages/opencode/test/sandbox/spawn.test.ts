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

  test("matches excluded command prefixes", () => {
    expect(SandboxSpawn.excluded(["rm", "-rf", "/tmp/test"], ["rm"]))?.toEqual({
      command: "rm",
      rule: "rm",
    })
    expect(SandboxSpawn.excluded(["git", "status"], ["git"]))?.toEqual({
      command: "git status",
      rule: "git",
    })
    expect(SandboxSpawn.excluded(["printf", "ok"], ["rm"]))?.toBeUndefined()
  })

  test("matches excluded commands through wrappers and shell text", () => {
    expect(SandboxSpawn.excluded(["env", "FOO=1", "python", "-c", "print(1)"], ["python"]))?.toEqual({
      command: "python -c",
      rule: "python",
    })
    expect(SandboxSpawn.excluded(["sh", "-c", "curl https://example.com"], ["curl"]))?.toEqual({
      command: "curl",
      rule: "curl",
    })
    expect(SandboxSpawn.excludedText("FOO=1 curl https://example.com", ["curl"]))?.toEqual({
      command: "curl",
      rule: "curl",
    })
    expect(SandboxSpawn.excludedText("echo ok\ncurl https://example.com", ["curl"]))?.toEqual({
      command: "curl",
      rule: "curl",
    })
    expect(SandboxSpawn.excludedText("echo ok & curl https://example.com", ["curl"]))?.toEqual({
      command: "curl",
      rule: "curl",
    })
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

  test("hard-fails when sandbox availability is required", () => {
    expect(() =>
      SandboxSpawn.plan({
        requested: true,
        platform: "linux",
        available: true,
        cwd: "/tmp/project",
        project_root: "/tmp/project",
        worktree_root: "/tmp/project",
        home: "/Users/tester",
        fail_if_unavailable: true,
      }),
    ).toThrow("unsupported_platform")

    expect(() =>
      SandboxSpawn.plan({
        requested: true,
        platform: "darwin",
        available: false,
        cwd: "/tmp/project",
        project_root: "/tmp/project",
        worktree_root: "/tmp/project",
        home: "/Users/tester",
        fail_if_unavailable: true,
      }),
    ).toThrow("sandbox_exec_missing")
  })

  test("falls back when hard-fail is disabled", () => {
    const platform = SandboxSpawn.plan({
      requested: true,
      platform: "linux",
      available: true,
      cwd: "/tmp/project",
      project_root: "/tmp/project",
      worktree_root: "/tmp/project",
      home: "/Users/tester",
    })
    const missing = SandboxSpawn.plan({
      requested: true,
      platform: "darwin",
      available: false,
      cwd: "/tmp/project",
      project_root: "/tmp/project",
      worktree_root: "/tmp/project",
      home: "/Users/tester",
    })

    expect(platform.active).toBe(false)
    expect(platform.diag.reason).toBe("unsupported_platform")
    expect(missing.active).toBe(false)
    expect(missing.diag.reason).toBe("sandbox_exec_missing")
  })

  test("detects likely sandbox denials conservatively", () => {
    expect(
      SandboxSpawn.retryReason({
        active: true,
        code: 1,
        stderr: "sandbox-exec: sandbox_apply: Operation not permitted",
      }),
    ).toBe("sandbox_denial")
    expect(
      SandboxSpawn.shouldRetry({
        active: true,
        code: 1,
        stderr: "sandbox-exec: sandbox_apply: Operation not permitted",
      }),
    ).toBe(true)
    expect(
      SandboxSpawn.shouldRetry({
        active: true,
        code: 1,
        stderr: "Sandbox: bash(1) deny(1) file-read-data /Users/tester/.ssh/secret",
      }),
    ).toBe(true)
    expect(
      SandboxSpawn.shouldRetry({
        active: true,
        code: 1,
        stderr: "Operation not permitted",
      }),
    ).toBe(true)
    expect(
      SandboxSpawn.shouldRetry({
        active: false,
        code: 1,
        stderr: "sandbox-exec: sandbox_apply: Operation not permitted",
      }),
    ).toBe(false)
    expect(
      SandboxSpawn.shouldRetry({
        active: true,
        code: 1,
        stderr: "permission denied",
      }),
    ).toBe(false)
  })

  test("classifies likely curl network failures when sandbox networking is disabled", () => {
    expect(
      SandboxSpawn.retryReason({
        active: true,
        code: 6,
        stderr: "curl: (6) Could not resolve host: example.com",
        allow_network: false,
        command: "FOO=1 curl -I https://example.com",
      }),
    ).toBe("possible_network_sandbox_denial")
    expect(
      SandboxSpawn.retryReason({
        active: true,
        code: 7,
        stderr: "curl: (7) Failed to connect to example.com port 443",
        allow_network: false,
        command: 'sh -c "curl https://example.com"',
      }),
    ).toBe("possible_network_sandbox_denial")
    expect(
      SandboxSpawn.retryReason({
        active: true,
        code: 6,
        stderr: "curl: (6) Could not resolve host: example.com",
        allow_network: true,
        command: "curl https://example.com",
      }),
    ).toBeUndefined()
    expect(
      SandboxSpawn.retryReason({
        active: true,
        code: 6,
        stderr: "curl: (6) Could not resolve host: example.com",
        allow_network: false,
        command: "python script.py",
      }),
    ).toBeUndefined()
  })

  test("extracts explicit unsandboxed directives from the first non-empty line", () => {
    expect(SandboxSpawn.directive("# opencode:unsandboxed needs network\ncurl https://example.com")).toEqual({
      command: "curl https://example.com",
      detail: "needs network",
    })
    expect(SandboxSpawn.directive("\n  # opencode:unsandboxed\ncat foo.txt")).toEqual({
      command: "\ncat foo.txt",
      detail: undefined,
    })
    expect(SandboxSpawn.directive("echo hi\n# opencode:unsandboxed later")).toEqual({
      command: "echo hi\n# opencode:unsandboxed later",
    })
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
