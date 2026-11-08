import { describe, expect, test } from "bun:test"
import { NodePath } from "@effect/platform-node"
import { Effect } from "effect"
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { isNushell, loadShellEnv, parseShellEnv, resolveUserShell } from "./shell-env"

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

  test("loadShellEnv falls back to the login shell probe when the interactive probe times out", async () => {
    const dir = mkdtempSync(join(tmpdir(), "shell-env-"))
    const script = join(dir, "slow-shell.sh")
    writeFileSync(script, "#!/bin/sh\nif [ \"$1\" = \"-il\" ]; then\n  sleep 6\nelse\n  env -0\nfi\n")
    chmodSync(script, 0o755)
    try {
      const env = await Effect.runPromise(loadShellEnv(script).pipe(Effect.provide(NodePath.layer)))
      expect(env).not.toBeNull()
      expect(env?.PATH).toBeDefined()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }, 15000)
})
