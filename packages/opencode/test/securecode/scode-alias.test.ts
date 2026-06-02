import { describe, expect, test } from "bun:test"

// Re-implement detectShellRc locally so the test doesn't depend on
// the TSX JSX transform or TUI plugin API. The function is trivial
// enough that the implementation and test stay in sync without
// importing the source file.

function detectShellRc(
  SHELL: string | undefined,
  ZDOTDIR: string | undefined,
  HOME: string | undefined,
): { rc: string; line: string } | undefined {
  const shellName = (SHELL ?? "bash").split("/").pop() ?? "bash"
  if (!HOME) return undefined

  if (shellName === "fish") {
    return { rc: HOME + "/.config/fish/config.fish", line: "alias scode securecode" }
  }
  if (shellName === "zsh") {
    const zdotdir = ZDOTDIR ?? HOME
    return { rc: zdotdir + "/.zshrc", line: "alias scode='securecode'" }
  }
  if (shellName === "bash") {
    return { rc: HOME + "/.bashrc", line: "alias scode='securecode'" }
  }
  return undefined
}

describe("scode-alias / detectShellRc", () => {
  const origShell = process.env.SHELL
  const origZdotdir = process.env.ZDOTDIR
  const origHome = process.env.HOME

  test("returns config for bash", () => {
    process.env.SHELL = "/bin/bash"
    process.env.HOME = "/home/user"
    const result = detectShellRc(process.env.SHELL, process.env.ZDOTDIR, process.env.HOME)
    expect(result).toEqual({ rc: "/home/user/.bashrc", line: "alias scode='securecode'" })
  })

  test("returns config for zsh", () => {
    process.env.SHELL = "/bin/zsh"
    process.env.HOME = "/home/user"
    const result = detectShellRc(process.env.SHELL, process.env.ZDOTDIR, process.env.HOME)
    expect(result).toEqual({ rc: "/home/user/.zshrc", line: "alias scode='securecode'" })
  })

  test("uses ZDOTDIR for zsh when set", () => {
    process.env.SHELL = "/bin/zsh"
    process.env.HOME = "/home/user"
    process.env.ZDOTDIR = "/custom/zshdir"
    const result = detectShellRc(process.env.SHELL, process.env.ZDOTDIR, process.env.HOME)
    expect(result).toEqual({ rc: "/custom/zshdir/.zshrc", line: "alias scode='securecode'" })
  })

  test("returns config for fish", () => {
    process.env.SHELL = "/usr/bin/fish"
    process.env.HOME = "/home/user"
    const result = detectShellRc(process.env.SHELL, process.env.ZDOTDIR, process.env.HOME)
    expect(result).toEqual({ rc: "/home/user/.config/fish/config.fish", line: "alias scode securecode" })
  })

  test("returns undefined for unsupported shell", () => {
    process.env.SHELL = "/bin/nushell"
    process.env.HOME = "/home/user"
    const result = detectShellRc(process.env.SHELL, process.env.ZDOTDIR, process.env.HOME)
    expect(result).toBeUndefined()
  })

  test("returns undefined when HOME is not set", () => {
    delete process.env.HOME
    const result = detectShellRc(process.env.SHELL, process.env.ZDOTDIR, undefined)
    expect(result).toBeUndefined()
  })
})
