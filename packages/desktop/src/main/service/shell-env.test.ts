import { describe, expect, test } from "bun:test"
import * as NodePath from "@effect/platform-node/NodePath"
import { Effect } from "effect"

import { isNushell, parseShellEnv, repairWindowsPath, resolveUserShell } from "./shell-env"

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

  test("resolveUserShell falls back to the login shell before /bin/sh", () => {
    expect(resolveUserShell("/custom/env-shell", "/bin/zsh")).toBe("/custom/env-shell")
    expect(resolveUserShell(undefined, "/bin/zsh")).toBe("/bin/zsh")
    expect(resolveUserShell(undefined, "unknown")).toBe("/bin/sh")
    expect(resolveUserShell(undefined, undefined)).toBe("/bin/sh")
  })

  test("isNushell handles path and binary name", () => {
    const check = (shell: string) => Effect.runSync(isNushell(shell).pipe(Effect.provide(NodePath.layer)))
    expect(check("nu")).toBe(true)
    expect(check("/opt/homebrew/bin/nu")).toBe(true)
    expect(check("C:\\Program Files\\nu.exe")).toBe(true)
    expect(check("/bin/zsh")).toBe(false)
  })

  test.each([4094, 4095, 4096, 16000])("repairs only the long machine-only Windows PATH (%i characters)", (length) => {
    const machine = "C:\\Windows\\System32"
    const user = "C:\\Tools;".repeat(2000).slice(0, length - machine.length - 1)
    expect(repairWindowsPath(machine, machine, user)).toBe(length < 4095 ? undefined : `${machine};${user}`)
  })

  test("preserves complete and customized Windows paths", () => {
    const machine = "C:\\Windows\\System32"
    const user = "C:\\Tools;".repeat(500)
    expect(repairWindowsPath(`${machine};${user}`, machine, user)).toBeUndefined()
    expect(repairWindowsPath(`C:\\venv\\Scripts;${machine}`, machine, user)).toBeUndefined()
    expect(repairWindowsPath("C:\\custom", machine, user)).toBeUndefined()
  })

  test("handles Windows path casing, separators, and Unicode", () => {
    const machine = "C:\\Windows\\System32;"
    const user = "C:\\Users\\使用者\\工具;".repeat(300)
    expect(repairWindowsPath(machine.toLowerCase(), machine, user)).toBe(machine + user)
    expect(parseShellEnv(Buffer.from(`machine=${machine}\0user=${user}`))).toEqual({ machine, user })
  })

  test("leaves missing Windows path values unchanged", () => {
    expect(repairWindowsPath(undefined, "C:\\Windows", "C:\\Tools")).toBeUndefined()
    expect(repairWindowsPath("C:\\Windows", undefined, "C:\\Tools")).toBeUndefined()
    expect(repairWindowsPath("C:\\Windows", "C:\\Windows", undefined)).toBeUndefined()
  })
})
