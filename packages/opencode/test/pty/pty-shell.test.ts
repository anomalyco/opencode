import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { Config } from "../../src/config/config"
import { Plugin } from "../../src/plugin"
import { PtyPreparation } from "../../src/pty-preparation"
import { Pty } from "@opencode-ai/core/pty"
import { Shell } from "../../src/shell/shell"
import { testEffect } from "../lib/effect"

Shell.preferred.reset()

const it = testEffect(Layer.mergeAll(Config.defaultLayer, Plugin.defaultLayer))
const preparationIt = testEffect(
  Layer.mergeAll(
    Layer.mock(Config.Service)({ get: () => Effect.succeed({}) }),
    Layer.mock(Plugin.Service)({
      trigger: <Name extends string, Input, Output>(_name: Name, _input: Input, output: Output) =>
        Effect.sync(() => {
          const result = output as { env: Record<string, string> }
          result.env.INPUT = "plugin"
          result.env.FROM_PLUGIN = "plugin"
          result.env.TERM = "plugin"
          return output
        }),
      list: () => Effect.succeed([]),
      init: () => Effect.void,
    }),
  ),
)

const preparePty = (input: Pty.CreateInput) => PtyPreparation.prepareCreate(input)

describe("pty shell args", () => {
  if (process.platform !== "win32") return

  const ps = Bun.which("pwsh") || Bun.which("powershell")
  if (ps) {
    it.instance(
      "does not add login args to pwsh",
      () =>
        Effect.gen(function* () {
          const info = yield* preparePty({ command: ps, title: "pwsh" })
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
          const info = yield* preparePty({ command: bash, title: "bash" })
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

        const info = yield* preparePty({ title: "configured" })
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

describe("pty environment preparation", () => {
  preparationIt.instance("merges plugin environment before forced PTY values", () =>
    Effect.gen(function* () {
      const input = { command: "/bin/sh", args: [] as string[], env: { INPUT: "caller" } }
      const prepared = yield* preparePty(input)

      expect(input.args).toEqual([])
      expect(prepared.env.INPUT).toBe("plugin")
      expect(prepared.env.FROM_PLUGIN).toBe("plugin")
      expect(prepared.env.TERM).toBe("xterm-256color")
      expect(prepared.env.OPENCODE_TERMINAL).toBe("1")
    }),
  )
})
