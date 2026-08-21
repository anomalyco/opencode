import { describe, expect, test } from "bun:test"
import path from "path"
import { Config } from "@opencode-ai/core/config"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { Environment } from "@opencode-ai/core/environment/index"
import { Bus } from "@opencode-ai/core/bus"
import { Location } from "@opencode-ai/core/location"
import { Global } from "@opencode-ai/util/global"
import { node, Service } from "@opencode-ai/core/shell"
import { Shell } from "@opencode-ai/schema/shell"
import { ShellSelect } from "@opencode-ai/core/shell/select"
import { FSUtil } from "@opencode-ai/util/fs-util"
import { which } from "@opencode-ai/core/util/which"
import { Effect, Fiber, Layer, Stream } from "effect"
import { ChildProcessSpawner } from "effect/unstable/process"
import { LayerNode } from "@opencode-ai/util/effect/layer-node"
import { hostEnvironmentLayer } from "./fixture/environment"
import { tempGlobalLayer } from "./fixture/global"
import { tempLocationLayer } from "./fixture/location"
import { testEffect } from "./lib/effect"

const immediateExitEnvironmentLayer = Layer.effect(
  Environment.Service,
  Effect.gen(function* () {
    const environment = yield* Environment.Service
    return Environment.Service.of({
      ...environment,
      spawner: ChildProcessSpawner.make(() =>
        Effect.succeed(
          ChildProcessSpawner.makeHandle({
            pid: ChildProcessSpawner.ProcessId(4242),
            exitCode: Effect.succeed(ChildProcessSpawner.ExitCode(0)),
            isRunning: Effect.succeed(false),
            kill: () => Effect.void,
            stdin: { [Symbol.for("effect/Sink/TypeId")]: Symbol.for("effect/Sink/TypeId") } as any,
            stdout: Stream.empty,
            stderr: Stream.empty,
            all: Stream.empty,
            getInputFd: () => ({ [Symbol.for("effect/Sink/TypeId")]: Symbol.for("effect/Sink/TypeId") }) as any,
            getOutputFd: () => Stream.empty,
            unref: Effect.succeed(Effect.void),
          }),
        ),
      ),
    })
  }),
).pipe(Layer.provide(hostEnvironmentLayer))

const shellTestLayer = (environment: Layer.Layer<Environment.Service>) =>
  AppNodeBuilder.build(LayerNode.group([node, Bus.node]), [
    [Config.node, Config.testLayer()],
    [Environment.node, environment],
    [Global.node, tempGlobalLayer],
    [Location.node, tempLocationLayer],
  ])

const it = testEffect(shellTestLayer(hostEnvironmentLayer))
const immediateExitIt = testEffect(shellTestLayer(immediateExitEnvironmentLayer))

const withShell = async (shell: string | undefined, fn: () => void | Promise<void>) => {
  const prev = process.env.SHELL
  if (shell === undefined) delete process.env.SHELL
  else process.env.SHELL = shell
  ShellSelect.acceptable.reset()
  ShellSelect.preferred.reset()
  try {
    await fn()
  } finally {
    if (prev === undefined) delete process.env.SHELL
    else process.env.SHELL = prev
    ShellSelect.acceptable.reset()
    ShellSelect.preferred.reset()
  }
}

describe("shell", () => {
  immediateExitIt.live("publishes the created shell PID before terminal state", () =>
    Effect.gen(function* () {
      const bus = yield* Bus.Service
      const shell = yield* Service
      const eventFiber = yield* bus
        .subscribe(Shell.Event.Created)
        .pipe(Stream.take(1), Stream.runCollect, Effect.forkScoped({ startImmediately: true }))

      const info = yield* shell.create({ command: "exit 0", timeout: 0 })
      const event = Array.from(yield* Fiber.join(eventFiber))[0]
      const created = event?.data.info

      expect(created?.id).toBe(info.id)
      expect(created?.pid).toBe(4242)
      expect(created?.status).toBe("running")
      expect(created?.exit).toBeUndefined()
      expect(created?.time.completed).toBeUndefined()

      const terminal = yield* shell.wait(info.id)
      expect(terminal.pid).toBe(created?.pid)
      expect(terminal.status).toBe("exited")
      expect(terminal.exit).toBe(0)
      expect(terminal.time.completed).toBeDefined()
    }),
  )

  test("normalizes shell names", () => {
    expect(ShellSelect.name("/bin/bash")).toBe("bash")
    if (process.platform === "win32") {
      expect(ShellSelect.name("C:/tools/NU.EXE")).toBe("nu")
      expect(ShellSelect.name("C:/tools/PWSH.EXE")).toBe("pwsh")
    }
  })

  test("detects login shells", () => {
    expect(ShellSelect.login("/bin/bash")).toBe(true)
    expect(ShellSelect.login("C:/tools/pwsh.exe")).toBe(false)
  })

  test("falls back when configured shell cannot be resolved", async () => {
    await withShell(undefined, async () => {
      const preferred = ShellSelect.preferred()
      const acceptable = ShellSelect.acceptable()
      expect(ShellSelect.preferred("opencode-missing-shell")).toBe(preferred)
      expect(ShellSelect.acceptable("opencode-missing-shell")).toBe(acceptable)
    })
  })

  test("falls back for terminal-only acceptable shells", () => {
    expect(ShellSelect.name(ShellSelect.acceptable("fish"))).not.toBe("fish")
    expect(ShellSelect.name(ShellSelect.acceptable("nu"))).not.toBe("nu")
  })

  test("builds command args per shell family", () => {
    expect(ShellSelect.args("/bin/sh", "echo hi")).toEqual(["-c", "echo hi"])
    expect(ShellSelect.args("/usr/bin/fish", "echo hi")).toEqual(["-c", "echo hi"])
    expect(ShellSelect.args("/bin/zsh", "echo hi")).toEqual(["-c", "echo hi"])
    expect(ShellSelect.args("/bin/bash", "echo hi")).toEqual(["-c", "echo hi"])
    expect(ShellSelect.args("pwsh", "Write-Output hi")).toEqual([
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      "Write-Output hi",
    ])
  })

  if (process.platform === "win32") {
    test("rejects blacklisted shells case-insensitively", async () => {
      await withShell("NU.EXE", async () => {
        expect(ShellSelect.name(ShellSelect.acceptable())).not.toBe("nu")
      })
    })

    test("normalizes Git Bash shell paths from env", async () => {
      const bash = ShellSelect.gitbash()
      if (!bash) return
      await withShell("NU.EXE", async () => {
        expect(ShellSelect.name(ShellSelect.acceptable())).not.toBe("nu")
      })
    })

    test("resolves /usr/bin/bash from env to Git Bash", async () => {
      const bash = ShellSelect.gitbash()
      if (!bash) return
      await withShell("/usr/bin/bash", async () => {
        expect(ShellSelect.acceptable()).toBe(bash)
        expect(ShellSelect.preferred()).toBe(bash)
      })
    })

    test("resolves bare bash to Git Bash before PATH", async () => {
      const bash = ShellSelect.gitbash()
      if (!bash) return
      expect(ShellSelect.acceptable("bash")).toBe(bash)
      expect(ShellSelect.preferred("bash")).toBe(bash)
      await withShell("bash", async () => {
        expect(ShellSelect.acceptable()).toBe(bash)
        expect(ShellSelect.preferred()).toBe(bash)
      })
    })

    test("resolves bare PowerShell shells", async () => {
      const shell = which("pwsh") || which("powershell")
      if (!shell) return
      await withShell(path.win32.basename(shell), async () => {
        expect(ShellSelect.preferred()).toBe(shell)
      })
    })
  }
})
