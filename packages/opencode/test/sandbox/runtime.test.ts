import { describe, expect, test } from "bun:test"
import { SandboxRuntime } from "../../src/sandbox/runtime"

describe("sandbox.runtime", () => {
  test("wraps commands with preset defaults", async () => {
    const out = await SandboxRuntime.plan({
      file: "/bin/zsh",
      args: ["-f", "-c", "pwd"],
      cwd: "/tmp/project/app",
      project_root: "/tmp/project/app",
      worktree_root: "/tmp/project",
      cfg: {
        requested: true,
        preset: "strict",
        presets: {},
        extra_deny_paths: [],
        excluded_commands: [],
        allow_unsandboxed_retry: false,
        fail_if_unavailable: false,
      },
    })

    expect(out.active).toBe(true)
    expect(out.file).toBe("/usr/bin/sandbox-exec")
    expect(out.args[2]).toBe("/bin/zsh")
    expect(out.diag.mode).toBe("read-only")
    expect(out.diag.allow_network).toBe(false)
  })

  test("lets explicit overrides win over preset defaults", async () => {
    const out = await SandboxRuntime.plan({
      file: "/bin/zsh",
      args: ["-f", "-c", "pwd"],
      cwd: "/tmp/project/app",
      project_root: "/tmp/project/app",
      worktree_root: "/tmp/project",
      mode: "read-only",
      allow_network: false,
      cfg: {
        requested: true,
        preset: "network",
        presets: {},
        extra_deny_paths: [],
        excluded_commands: [],
        allow_unsandboxed_retry: false,
        fail_if_unavailable: false,
      },
    })

    expect(out.diag.mode).toBe("read-only")
    expect(out.diag.allow_network).toBe(false)
  })
})
