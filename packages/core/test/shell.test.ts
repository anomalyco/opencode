import { describe, expect, test } from "bun:test"
import path from "path"
import { spawnSync } from "child_process"
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, rmSync } from "fs"
import { Shell } from "@opencode-ai/core/shell"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { which } from "@opencode-ai/core/util/which"

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

  test("preserves inherited venv after bash -l with rc reordering", () => {
    if (process.platform === "win32") return
    const bash = which("bash")
    if (!bash) return

    const tmp = mkdtempSync("/tmp/opencode-test-venv-")
    const home = path.join(tmp, "home")
    const venv = path.join(tmp, "venv")
    const system = path.join(tmp, "system-bin")
    try {
      mkdirSync(path.join(venv, "bin"), { recursive: true })
      mkdirSync(home, { recursive: true })
      mkdirSync(system, { recursive: true })

      writeFileSync(
        path.join(venv, "bin", "python"),
        "#!/usr/bin/env bash\necho 'venv-python'\nexit 0\n",
      )
      chmodSync(path.join(venv, "bin", "python"), 0o755)
      writeFileSync(
        path.join(system, "python"),
        "#!/usr/bin/env bash\necho 'system-python'\nexit 1\n",
      )
      chmodSync(path.join(system, "python"), 0o755)
      writeFileSync(path.join(home, ".bashrc"), `export PATH="${system}:\$PATH"`, "utf8")

      const args = Shell.args(bash, "command -v python", "/tmp")
      const result = spawnSync(bash, args, {
        env: {
          HOME: home,
          VIRTUAL_ENV: venv,
          PATH: `${venv}/bin:${system}:/usr/bin:/bin`,
          LC_ALL: "C.UTF-8",
        },
        cwd: "/tmp",
        stdio: ["ignore", "pipe", "ignore"],
        timeout: 10_000,
      })

      expect(result.status).toBe(0)
      expect(result.stdout.toString("utf8").trim()).toBe(path.join(venv, "bin", "python"))
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })

  test("preserves inherited conda after bash -l with rc reordering", () => {
    if (process.platform === "win32") return
    const bash = which("bash")
    if (!bash) return

    const tmp = mkdtempSync("/tmp/opencode-test-conda-")
    const home = path.join(tmp, "home")
    const conda = path.join(tmp, "conda")
    const system = path.join(tmp, "system-bin")
    try {
      mkdirSync(path.join(conda, "bin"), { recursive: true })
      mkdirSync(home, { recursive: true })
      mkdirSync(system, { recursive: true })

      writeFileSync(
        path.join(conda, "bin", "python"),
        "#!/usr/bin/env bash\necho 'conda-python'\nexit 0\n",
      )
      chmodSync(path.join(conda, "bin", "python"), 0o755)
      writeFileSync(
        path.join(system, "python"),
        "#!/usr/bin/env bash\necho 'system-python'\nexit 1\n",
      )
      chmodSync(path.join(system, "python"), 0o755)
      writeFileSync(path.join(home, ".bashrc"), `export PATH="${system}:\$PATH"`, "utf8")

      const args = Shell.args(bash, "command -v python", "/tmp")
      const result = spawnSync(bash, args, {
        env: {
          HOME: home,
          CONDA_PREFIX: conda,
          PATH: `${conda}/bin:${system}:/usr/bin:/bin`,
          LC_ALL: "C.UTF-8",
        },
        cwd: "/tmp",
        stdio: ["ignore", "pipe", "ignore"],
        timeout: 10_000,
      })

      expect(result.status).toBe(0)
      expect(result.stdout.toString("utf8").trim()).toBe(path.join(conda, "bin", "python"))
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })

  test("preserves inherited venv after zsh -l with rc reordering", () => {
    if (process.platform === "win32") return
    const zsh = which("zsh")
    if (!zsh) return

    const tmp = mkdtempSync("/tmp/opencode-test-zsh-venv-")
    const home = path.join(tmp, "home")
    const venv = path.join(tmp, "venv")
    const system = path.join(tmp, "system-bin")
    try {
      mkdirSync(path.join(venv, "bin"), { recursive: true })
      mkdirSync(home, { recursive: true })
      mkdirSync(system, { recursive: true })

      writeFileSync(
        path.join(venv, "bin", "python"),
        "#!/usr/bin/env zsh\necho 'zsh-venv-python'\nexit 0\n",
      )
      chmodSync(path.join(venv, "bin", "python"), 0o755)
      writeFileSync(
        path.join(system, "python"),
        "#!/usr/bin/env zsh\necho 'system-python'\nexit 1\n",
      )
      chmodSync(path.join(system, "python"), 0o755)
      writeFileSync(path.join(home, ".zshrc"), `export PATH="${system}:\$PATH"`, "utf8")

      const args = Shell.args(zsh, "command -v python", "/tmp")
      const result = spawnSync(zsh, args, {
        env: {
          HOME: home,
          VIRTUAL_ENV: venv,
          PATH: `${venv}/bin:${system}:/usr/bin:/bin`,
          LC_ALL: "C.UTF-8",
        },
        cwd: "/tmp",
        stdio: ["ignore", "pipe", "ignore"],
        timeout: 10_000,
      })

      expect(result.status).toBe(0)
      expect(result.stdout.toString("utf8").trim()).toBe(path.join(venv, "bin", "python"))
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })

  test("does not duplicate venv bin already first in PATH after bash -l", () => {
    if (process.platform === "win32") return
    const bash = which("bash")
    if (!bash) return

    const tmp = mkdtempSync("/tmp/opencode-test-venv-dup-")
    const home = path.join(tmp, "home")
    const venv = path.join(tmp, "venv")
    try {
      mkdirSync(path.join(venv, "bin"), { recursive: true })
      mkdirSync(home, { recursive: true })
      writeFileSync(path.join(home, ".bashrc"), "# rc leaves PATH untouched\n", "utf8")

      const args = Shell.args(bash, "echo $PATH", "/tmp")
      const result = spawnSync(bash, args, {
        env: {
          HOME: home,
          VIRTUAL_ENV: venv,
          PATH: `${venv}/bin:/usr/bin:/bin`,
          LC_ALL: "C.UTF-8",
        },
        cwd: "/tmp",
        stdio: ["ignore", "pipe", "ignore"],
        timeout: 10_000,
      })

      expect(result.status).toBe(0)
      const entries = result.stdout.toString("utf8").trim().split(":")
      expect(entries[0]).toBe(path.join(venv, "bin"))
      // macOS /etc/profile (path_helper) demotes the venv bin even when rc files
      // leave PATH alone, so the guard re-prepends and an inert second copy
      // remains mid-PATH. Elsewhere the untouched PATH keeps it first and the
      // guard skips the prepend entirely.
      if (process.platform !== "darwin") {
        expect(entries.filter((entry) => entry === path.join(venv, "bin"))).toHaveLength(1)
      }
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })

  test("does not duplicate venv bin already first in PATH in fish -c", () => {
    if (process.platform === "win32") return
    const fish = which("fish")
    if (!fish) return

    const tmp = mkdtempSync("/tmp/opencode-test-fish-dup-")
    const home = path.join(tmp, "home")
    const venv = path.join(tmp, "venv")
    try {
      mkdirSync(path.join(venv, "bin"), { recursive: true })
      mkdirSync(home, { recursive: true })

      const args = Shell.args(fish, "string join : $PATH", "/tmp")
      const result = spawnSync(fish, args, {
        env: {
          HOME: home,
          VIRTUAL_ENV: venv,
          PATH: `${venv}/bin:/usr/bin:/bin`,
          LC_ALL: "C.UTF-8",
        },
        cwd: "/tmp",
        stdio: ["ignore", "pipe", "ignore"],
        timeout: 10_000,
      })

      expect(result.status).toBe(0)
      const entries = result.stdout.toString("utf8").trim().split(":")
      expect(entries[0]).toBe(path.join(venv, "bin"))
      expect(entries.filter((entry) => entry === path.join(venv, "bin"))).toHaveLength(1)
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })

  test("fish args includes venv prelude", () => {
    if (process.platform === "win32") return
    const fish = which("fish")
    if (!fish) return

    const args = Shell.args(fish, "command -v python", "/tmp")
    expect(args[0]).toBe("-c")
    expect(args[1]).toContain("set -q VIRTUAL_ENV")
    expect(args[1]).toContain("set -q CONDA_PREFIX")
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

  test("builds command args per shell family", () => {
    expect(Shell.args("/bin/sh", "echo hi", "/tmp")).toEqual(["-c", "echo hi"])
    expect(Shell.args("/bin/nu", "echo hi", "/tmp")).toEqual(["-c", "echo hi"])
    const fish = Shell.args("/usr/bin/fish", "echo hi", "/tmp")
    expect(fish[0]).toBe("-c")
    expect(fish[1]).toContain("set -q VIRTUAL_ENV")
    expect(fish[1]).toContain("set -q CONDA_PREFIX")
    const zsh = Shell.args("/bin/zsh", "echo hi", "/tmp")
    expect(zsh[0]).toBe("-l")
    expect(zsh[1]).toBe("-c")
    expect(zsh.at(-1)).toBe("/tmp")
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
        expect(Shell.preferred()).toBe(FSUtil.windowsPath(shell))
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
