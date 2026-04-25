import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { Shell } from "../../src/shell/shell"
import { Filesystem } from "../../src/util"
import { tmpdir } from "../fixture/fixture"

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

const WINDOWS_ENV_KEYS = ["Path", "PATHEXT", "WINDIR", "SystemRoot"] as const

const withWindowsEnv = async (
  env: Partial<Record<(typeof WINDOWS_ENV_KEYS)[number], string | undefined>>,
  fn: () => void | Promise<void>,
) => {
  const prev = Object.fromEntries(WINDOWS_ENV_KEYS.map((key) => [key, process.env[key]]))
  for (const key of WINDOWS_ENV_KEYS) {
    if (env[key] === undefined) delete process.env[key]
    else process.env[key] = env[key]
  }
  try {
    await fn()
  } finally {
    for (const key of WINDOWS_ENV_KEYS) {
      if (prev[key] === undefined) delete process.env[key]
      else process.env[key] = prev[key]
    }
  }
}

const writeExe = async (file: string) => {
  await fs.mkdir(path.dirname(file), { recursive: true })
  await Bun.write(file, "x")
}

describe("shell", () => {
  test("normalizes shell names", () => {
    expect(Shell.name("/bin/bash")).toBe("bash")
    if (process.platform === "win32") {
      expect(Shell.name("C:/tools/NU.EXE")).toBe("nu")
      expect(Shell.name("C:/tools/PWSH.EXE")).toBe("pwsh")
    }
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

    test("prefers bash from PATH over git-derived paths", async () => {
      await using tmp = await tmpdir()
      const bash = path.join(tmp.path, "msys64", "usr", "bin", "bash.exe")
      const git = path.join(tmp.path, "Git", "cmd", "git.exe")

      await writeExe(bash)
      await writeExe(git)
      await writeExe(path.join(tmp.path, "Git", "bin", "bash.exe"))

      await withWindowsEnv(
        {
          Path: [path.dirname(bash), path.dirname(git)].join(path.delimiter),
          PATHEXT: ".EXE",
        },
        async () => {
          expect(Shell.gitbash()?.toLowerCase()).toBe(bash.toLowerCase())
        },
      )
    })

    test("resolves MSYS2 UCRT64 git layout", async () => {
      await using tmp = await tmpdir()
      const git = path.join(tmp.path, "msys64", "ucrt64", "bin", "git.exe")
      const bash = path.join(tmp.path, "msys64", "usr", "bin", "bash.exe")

      await writeExe(git)
      await writeExe(bash)

      await withWindowsEnv(
        {
          Path: path.dirname(git),
          PATHEXT: ".EXE",
        },
        async () => {
          expect(Shell.gitbash()).toBe(bash)
        },
      )
    })

    test("ignores WSL bash from Windows system directories", async () => {
      await using tmp = await tmpdir()
      const windows = path.join(tmp.path, "Windows")
      const git = path.join(tmp.path, "Git", "cmd", "git.exe")
      const bash = path.join(tmp.path, "Git", "bin", "bash.exe")

      await writeExe(path.join(windows, "System32", "bash.exe"))
      await writeExe(git)
      await writeExe(bash)

      await withWindowsEnv(
        {
          Path: [path.join(windows, "System32"), path.dirname(git)].join(path.delimiter),
          PATHEXT: ".EXE",
          WINDIR: windows,
          SystemRoot: windows,
        },
        async () => {
          expect(Shell.gitbash()).toBe(bash)
        },
      )
    })

    test("resolves bare PowerShell shells", async () => {
      const shell = Bun.which("pwsh") || Bun.which("powershell")
      if (!shell) return
      await withShell(path.win32.basename(shell), async () => {
        expect(Shell.preferred()).toBe(shell)
      })
    })
  }
})
