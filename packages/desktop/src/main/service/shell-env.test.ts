import { describe, expect, test } from "bun:test"
import { NodePath } from "@effect/platform-node"
import { Effect } from "effect"

import { isNushell, parseShellEnv, resolveUserShell } from "./shell-env"

describe("shell env", () => {
  test("parseShellEnv reads null-delimited pairs and ignores invalid entries", () => {
    expect(parseShellEnv(Buffer.from("PATH=/usr/bin:/bin\0FOO=bar=baz\0\0INVALID\0=empty\0OK=1\0"))).toEqual({
      PATH: "/usr/bin:/bin",
      FOO: "bar=baz",
      OK: "1",
    })
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
})
