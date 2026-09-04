import { describe, expect, test } from "bun:test"
import path from "path"
import { ShellSelect } from "@opencode-ai/core/shell/select"
import { FSUtil } from "@opencode-ai/util/fs-util"
import { which } from "@opencode-ai/core/util/which"
import fs from "node:fs/promises"
import { tmpdir } from "./fixture/tmpdir"

const withShell = async (shell: string | undefined, fn: () => void | Promise<void>) => {
  const prev = process.env.SHELL
  if (shell === undefined) delete process.env.SHELL
  else process.env.SHELL = shell
  ShellSelect.resolve.reset()
  try {
    await fn()
  } finally {
    if (prev === undefined) delete process.env.SHELL
    else process.env.SHELL = prev
    ShellSelect.resolve.reset()
  }
}

describe("shell", () => {
  test("normalizes shell names", () => {
    expect(ShellSelect.name("/bin/bash")).toBe("bash")
    if (process.platform === "win32") {
      expect(ShellSelect.name("C:/tools/NU.EXE")).toBe("nu")
      expect(ShellSelect.name("C:/tools/PWSH.EXE")).toBe("pwsh")
    }
  })

  test("detects login shells", () => {
    expect(ShellSelect.login("/bin/bash")).toBe(true)
    expect(ShellSelect.login("C:/tools/pwsh.exe")).toBe(false)
  })

  test("falls back when configured shell cannot be resolved", async () => {
    await withShell(undefined, async () => {
      const configured = ShellSelect.resolve({ priority: "config" })
      const compatible = ShellSelect.resolve({ priority: "compat" })
      expect(ShellSelect.resolve({ priority: "config" }, "opencode-missing-shell")).toBe(configured)
      expect(ShellSelect.resolve({ priority: "compat" }, "opencode-missing-shell")).toBe(compatible)
    })
  })

  test("falls back for terminal-only shells when compatibility is required", () => {
    expect(ShellSelect.name(ShellSelect.resolve({ priority: "compat" }, "fish"))).not.toBe("fish")
    expect(ShellSelect.name(ShellSelect.resolve({ priority: "compat" }, "nu"))).not.toBe("nu")
  })

  test("builds command args per shell family", () => {
    expect(ShellSelect.args("/bin/sh", "echo hi")).toEqual(["-c", "echo hi"])
    expect(ShellSelect.args("/usr/bin/fish", "echo hi")).toEqual(["-c", "echo hi"])
    expect(ShellSelect.args("/bin/zsh", "echo hi")).toEqual(["-c", "echo hi"])
    expect(ShellSelect.args("/bin/bash", "echo hi")).toEqual(["-c", "echo hi"])
    expect(ShellSelect.args("pwsh", "Write-Output hi")).toEqual([
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      "Write-Output hi",
    ])
  })

  if (process.platform !== "win32") {
    test("resolves the environment shell without retaining a removed executable", async () => {
      await withShell(undefined, async () => {
        await using directory = await tmpdir()
        const fallback = ShellSelect.environment()
        const shell = path.join(directory.path, "preferred-shell")
        await fs.symlink("/bin/sh", shell)
        process.env.SHELL = shell
        expect(ShellSelect.environment()).toBe(shell)
        expect(ShellSelect.resolve({ priority: "config" })).toBe(shell)
        await fs.unlink(shell)
        expect(ShellSelect.environment()).toBe(fallback)
      })
    })
  }

  if (process.platform === "win32") {
    test("rejects blacklisted shells case-insensitively", async () => {
      await withShell("NU.EXE", async () => {
        expect(ShellSelect.name(ShellSelect.resolve({ priority: "compat" }))).not.toBe("nu")
      })
    })

    test("normalizes Git Bash shell paths from env", async () => {
      const shell = "/cygdrive/c/Program Files/Git/bin/bash.exe"
      await withShell(shell, async () => {
        expect(ShellSelect.resolve({ priority: "config" })).toBe(FSUtil.windowsPath(shell))
      })
    })

    test("resolves /usr/bin/bash from env to Git Bash", async () => {
      const bash = ShellSelect.gitbash()
      if (!bash) return
      await withShell("/usr/bin/bash", async () => {
        expect(ShellSelect.resolve({ priority: "compat" })).toBe(bash)
        expect(ShellSelect.resolve({ priority: "config" })).toBe(bash)
      })
    })

    test("resolves bare bash to Git Bash before PATH", async () => {
      const bash = ShellSelect.gitbash()
      if (!bash) return
      expect(ShellSelect.resolve({ priority: "compat" }, "bash")).toBe(bash)
      expect(ShellSelect.resolve({ priority: "config" }, "bash")).toBe(bash)
      await withShell("bash", async () => {
        expect(ShellSelect.resolve({ priority: "compat" })).toBe(bash)
        expect(ShellSelect.resolve({ priority: "config" })).toBe(bash)
      })
    })

    test("resolves bare PowerShell shells", async () => {
      const shell = which("pwsh") || which("powershell")
      if (!shell) return
      await withShell(path.win32.basename(shell), async () => {
        expect(ShellSelect.resolve({ priority: "config" })).toBe(shell)
      })
    })
  }
})
