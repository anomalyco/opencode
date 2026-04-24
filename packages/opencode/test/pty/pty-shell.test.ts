import { describe, expect, test } from "bun:test"
import { AppRuntime } from "../../src/effect/app-runtime"
import { Effect } from "effect"
import { Instance } from "../../src/project/instance"
import { Pty } from "../../src/pty"
import { Shell } from "../../src/shell/shell"
import { tmpdir } from "../fixture/fixture"

Shell.preferred.reset()

describe("pty shell args", () => {
  if (process.platform !== "win32") return

  const ps = Bun.which("pwsh") || Bun.which("powershell")
  if (ps) {
    test(
      "does not add login args to pwsh",
      async () => {
        await using dir = await tmpdir()
        await Instance.provide({
          directory: dir.path,
          fn: () =>
            AppRuntime.runPromise(
              Effect.gen(function* () {
                const pty = yield* Pty.Service
                const info = yield* pty.create({ command: ps, title: "pwsh" })
                try {
                  expect(info.args).toEqual([])
                } finally {
                  yield* pty.remove(info.id)
                }
              }),
            ),
        })
      },
      { timeout: 30000 },
    )
  }

  const bash = (() => {
    const shell = Shell.preferred()
    if (Shell.name(shell) === "bash") return shell
    return Shell.gitbash()
  })()
  if (bash) {
    test(
      "adds login args to bash",
      async () => {
        await using dir = await tmpdir()
        await Instance.provide({
          directory: dir.path,
          fn: () =>
            AppRuntime.runPromise(
              Effect.gen(function* () {
                const pty = yield* Pty.Service
                const info = yield* pty.create({ command: bash, title: "bash" })
                try {
                  expect(info.args).toEqual(["-l"])
                } finally {
                  yield* pty.remove(info.id)
                }
              }),
            ),
        })
      },
      { timeout: 30000 },
    )
  }
})
