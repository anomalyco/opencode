import { describe, expect, test } from "bun:test"

import { isNushell, mergeShellEnv, parseShellEnv, resolveUserShell, restoreVirtualEnv } from "./shell-env"

describe("shell env", () => {
  test("parseShellEnv supports null-delimited pairs", () => {
    const env = parseShellEnv(Buffer.from("PATH=/usr/bin:/bin\0FOO=bar=baz\0\0"))

    expect(env.PATH).toBe("/usr/bin:/bin")
    expect(env.FOO).toBe("bar=baz")
  })

  test("parseShellEnv ignores invalid entries", () => {
    const env = parseShellEnv(Buffer.from("INVALID\0=empty\0OK=1\0"))

    expect(Object.keys(env).length).toBe(1)
    expect(env.OK).toBe("1")
  })

  test("mergeShellEnv keeps explicit overrides", () => {
    const env = mergeShellEnv(
      {
        PATH: "/shell/path",
        HOME: "/tmp/home",
      },
      {
        PATH: "/desktop/path",
        OPENCODE_CLIENT: "desktop",
      },
    )

    expect(env.PATH).toBe("/desktop/path")
    expect(env.HOME).toBe("/tmp/home")
    expect(env.OPENCODE_CLIENT).toBe("desktop")
  })

  test("resolveUserShell falls back to the login shell before /bin/sh", () => {
    expect(resolveUserShell("/custom/env-shell", "/bin/zsh")).toBe("/custom/env-shell")
    expect(resolveUserShell(undefined, "/bin/zsh")).toBe("/bin/zsh")
    expect(resolveUserShell(undefined, "unknown")).toBe("/bin/sh")
    expect(resolveUserShell(undefined, undefined)).toBe("/bin/sh")
  })

  test("isNushell handles path and binary name", () => {
    expect(isNushell("nu")).toBe(true)
    expect(isNushell("/opt/homebrew/bin/nu")).toBe(true)
    expect(isNushell("C:\\Program Files\\nu.exe")).toBe(true)
    expect(isNushell("/bin/zsh")).toBe(false)
  })

  test("restoreVirtualEnv prepends venv bin to PATH", () => {
    const env: Record<string, string | undefined> = { PATH: "/usr/bin:/bin" }
    restoreVirtualEnv(env, { VIRTUAL_ENV: "/tmp/venv", CONDA_PREFIX: undefined })
    expect(env.VIRTUAL_ENV).toBe("/tmp/venv")
    expect(env.PATH).toBe("/tmp/venv/bin:/usr/bin:/bin")
  })

  test("restoreVirtualEnv prepends conda bin when conda prefix set", () => {
    const env: Record<string, string | undefined> = { PATH: "/usr/bin:/bin" }
    restoreVirtualEnv(env, { VIRTUAL_ENV: undefined, CONDA_PREFIX: "/tmp/conda" })
    expect(env.CONDA_PREFIX).toBe("/tmp/conda")
    expect(env.PATH).toBe("/tmp/conda/bin:/usr/bin:/bin")
  })

  test("restoreVirtualEnv orders conda before venv in PATH", () => {
    const env: Record<string, string | undefined> = { PATH: "/usr/bin:/bin" }
    restoreVirtualEnv(env, { VIRTUAL_ENV: "/tmp/venv", CONDA_PREFIX: "/tmp/conda" })
    expect(env.CONDA_PREFIX).toBe("/tmp/conda")
    expect(env.VIRTUAL_ENV).toBe("/tmp/venv")
    // conda prepended first, venv prepended second → venv wins at front
    expect(env.PATH).toBe("/tmp/venv/bin:/tmp/conda/bin:/usr/bin:/bin")
  })

  test("restoreVirtualEnv no-op when neither venv nor conda set", () => {
    const env: Record<string, string | undefined> = { PATH: "/usr/bin:/bin" }
    restoreVirtualEnv(env, { VIRTUAL_ENV: undefined, CONDA_PREFIX: undefined })
    expect(env.PATH).toBe("/usr/bin:/bin")
    expect(env.VIRTUAL_ENV).toBeUndefined()
    expect(env.CONDA_PREFIX).toBeUndefined()
  })

  test("restoreVirtualEnv sets PATH when no PATH existed", () => {
    const env: Record<string, string | undefined> = {}
    restoreVirtualEnv(env, { VIRTUAL_ENV: "/tmp/venv", CONDA_PREFIX: undefined })
    expect(env.VIRTUAL_ENV).toBe("/tmp/venv")
    expect(env.PATH).toBe("/tmp/venv/bin")
  })

  test("restoreVirtualEnv does not duplicate bin already first in PATH", () => {
    const env: Record<string, string | undefined> = { PATH: "/tmp/venv/bin:/usr/bin:/bin" }
    restoreVirtualEnv(env, { VIRTUAL_ENV: "/tmp/venv", CONDA_PREFIX: undefined })
    expect(env.PATH).toBe("/tmp/venv/bin:/usr/bin:/bin")
  })

  test("restoreVirtualEnv re-prepends bin demoted from first in PATH", () => {
    const env: Record<string, string | undefined> = { PATH: "/usr/bin:/tmp/venv/bin:/bin" }
    restoreVirtualEnv(env, { VIRTUAL_ENV: "/tmp/venv", CONDA_PREFIX: undefined })
    expect(env.PATH).toBe("/tmp/venv/bin:/usr/bin:/tmp/venv/bin:/bin")
  })
})
