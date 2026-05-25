import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { Pty } from "../../src/pty"
import { Shell } from "../../src/shell/shell"
import { testEffect } from "../lib/effect"

Shell.preferred.reset()

const it = testEffect(Pty.defaultLayer)

const createPty = (input: Pty.CreateInput) =>
  Effect.acquireRelease(
    Effect.gen(function* () {
      const pty = yield* Pty.Service
      const info = yield* pty.create(input)
      return { pty, info }
    }),
    ({ pty, info }) => pty.remove(info.id).pipe(Effect.ignore),
  ).pipe(Effect.map(({ info }) => info))

describe("pty shell args", () => {
  if (process.platform !== "win32") return

  const ps = Bun.which("pwsh") || Bun.which("powershell")
  if (ps) {
    it.instance(
      "does not add login args to pwsh",
      () =>
        Effect.gen(function* () {
          const info = yield* createPty({ command: ps, title: "pwsh" })
          expect(info.args).toEqual([])
        }),
      { timeout: 30000 },
    )
  }

  const bash = (() => {
    const shell = Shell.preferred()
    if (Shell.name(shell) === "bash") return shell
    return Shell.gitbash()
  })()
  if (bash) {
    it.instance(
      "adds login args to bash",
      () =>
        Effect.gen(function* () {
          const info = yield* createPty({ command: bash, title: "bash" })
          expect(info.args).toEqual(["-l"])
        }),
      { timeout: 30000 },
    )
  }
})

describe("pty configured shell", () => {
  const configured = process.platform === "win32" ? Bun.which("pwsh") || Bun.which("powershell") : Bun.which("bash")

  it.instance(
    "uses configured shell for default PTY command",
    () =>
      Effect.gen(function* () {
        if (!configured) return

        const info = yield* createPty({ title: "configured" })
        if (process.platform === "win32") {
          expect(info.command.toLowerCase()).toBe(configured.toLowerCase())
        } else {
          expect(info.command).toBe(configured)
        }
        expect(info.args).toEqual(process.platform === "win32" ? [] : ["-l"])
      }),
    configured ? { config: { shell: Shell.name(configured) } } : undefined,
    { timeout: 30000 },
  )
})
