import { describe, expect, test } from "bun:test"
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { NodePath } from "@effect/platform-node"
import { Effect } from "effect"

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

  // The fake shell fails `-il` and holds `-l` until the test releases it, which a blocking probe never lets happen.
  test.skipIf(process.platform === "win32")(
    "loadShellEnv falls back to -l without blocking the event loop",
    async () => {
      const root = mkdtempSync(path.join(tmpdir(), "opencode-shell-env-"))
      const shell = path.join(root, "shell")
      const release = path.join(root, "release")

      try {
        writeFileSync(
          shell,
          `#!/bin/sh\n[ "$1" = "-il" ] && exit 1\nwhile [ ! -e "${release}" ]; do sleep 0.01; done\nFAKE_SHELL_ENV=1 exec /bin/sh -c "$3"\n`,
        )
        chmodSync(shell, 0o755)
        const env = Effect.runPromise(loadShellEnv(shell).pipe(Effect.provide(NodePath.layer)))

        writeFileSync(release, "")
        expect((await env)?.FAKE_SHELL_ENV).toBe("1")
      } finally {
        rmSync(root, { recursive: true, force: true })
      }
    },
  )
})
