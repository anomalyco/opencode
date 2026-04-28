import { describe, expect, test } from "bun:test"
import path from "path"
import { Shell } from "../../src/shell/shell"
import { Filesystem } from "@/util/filesystem"
import { which } from "../../src/util/which"

const withShell = async (shell: string | undefined, fn: () => void | Promise<void>) => {
  const prev = process.env.SHELL
  if (shell === undefined) delete process.env.SHELL
  else process.env.SHELL = shell
  Shell.acceptable.reset()
  Shell.preferred.reset()
  try {
    await fn()
  } finally {
    if (prev === undefined) delete process.env.SHELL
    else process.env.SHELL = prev
    Shell.acceptable.reset()
    Shell.preferred.reset()
  }
}

describe("shell", () => {
  test("normalizes shell names", () => {
    expect(Shell.name("/bin/bash")).toBe("bash")
    if (process.platform === "win32") {
      expect(Shell.name("C:/tools/NU.EXE")).toBe("nu")
      expect(Shell.name("C:/tools/PWSH.EXE")).toBe("pwsh")
    }
  })

  test("Shell.ps detects powershell shells", () => {
    expect(Shell.ps("/bin/pwsh")).toBe(true)
    expect(Shell.ps("powershell")).toBe(true)
    expect(Shell.ps("/bin/bash")).toBe(false)
    expect(Shell.ps("/bin/zsh")).toBe(false)
  })

  test("Shell.args returns correct flags for bash", () => {
    const result = Shell.args("/bin/bash", "echo hello", "/tmp")
    expect(result[0]).toBe("-l")
    expect(result[1]).toBe("-c")
    expect(result[result.length - 1]).toBe("/tmp")
  })

  test("Shell.args returns correct flags for zsh", () => {
    const result = Shell.args("/bin/zsh", "echo hello", "/tmp")
    expect(result[0]).toBe("-l")
    expect(result[1]).toBe("-c")
    expect(result[result.length - 1]).toBe("/tmp")
  })

  test("Shell.args returns -c for nu and fish", () => {
    expect(Shell.args("/bin/nu", "echo hi", "/tmp")).toEqual(["-c", "echo hi"])
    expect(Shell.args("/bin/fish", "echo hi", "/tmp")).toEqual(["-c", "echo hi"])
  })

  test("Shell.args returns /c for cmd", () => {
    expect(Shell.args("cmd", "echo hi", "/tmp")).toEqual(["/c", "echo hi"])
  })

  test("detects login shells", () => {
    expect(Shell.login("/bin/bash")).toBe(true)
    expect(Shell.login("C:/tools/pwsh.exe")).toBe(false)
  })

  test("detects posix shells", () => {
    expect(Shell.posix("/bin/bash")).toBe(true)
    expect(Shell.posix("/bin/fish")).toBe(false)
    expect(Shell.posix("C:/tools/pwsh.exe")).toBe(false)
  })

  test("falls back when configured shell cannot be resolved", async () => {
    await withShell(undefined, async () => {
      const preferred = Shell.preferred()
      const acceptable = Shell.acceptable()
      expect(Shell.preferred("opencode-missing-shell")).toBe(preferred)
      expect(Shell.acceptable("opencode-missing-shell")).toBe(acceptable)
    })
  })

  test("falls back for terminal-only acceptable shells", () => {
    expect(Shell.name(Shell.acceptable("fish"))).not.toBe("fish")
    expect(Shell.name(Shell.acceptable("nu"))).not.toBe("nu")
  })

  if (process.platform === "win32") {
    test("rejects blacklisted shells case-insensitively", async () => {
      await withShell("NU.EXE", async () => {
        expect(Shell.name(Shell.acceptable())).not.toBe("nu")
      })
    })

    test("normalizes Git Bash shell paths from env", async () => {
      const shell = "/cygdrive/c/Program Files/Git/bin/bash.exe"
      await withShell(shell, async () => {
        expect(Shell.preferred()).toBe(Filesystem.windowsPath(shell))
      })
    })

    test("resolves /usr/bin/bash from env to Git Bash", async () => {
      const bash = Shell.gitbash()
      if (!bash) return
      await withShell("/usr/bin/bash", async () => {
        expect(Shell.acceptable()).toBe(bash)
        expect(Shell.preferred()).toBe(bash)
      })
    })

    test("resolves bare bash to Git Bash before PATH", async () => {
      const bash = Shell.gitbash()
      if (!bash) return
      expect(Shell.acceptable("bash")).toBe(bash)
      expect(Shell.preferred("bash")).toBe(bash)
      await withShell("bash", async () => {
        expect(Shell.acceptable()).toBe(bash)
        expect(Shell.preferred()).toBe(bash)
      })
    })

    test("resolves bare PowerShell shells", async () => {
      const shell = which("pwsh") || which("powershell")
      if (!shell) return
      await withShell(path.win32.basename(shell), async () => {
        expect(Shell.preferred()).toBe(shell)
      })
    })
  }
})
