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
import { Effect, Fiber, Stream } from "effect"
import { LayerNode } from "@opencode-ai/util/effect/layer-node"
import { hostEnvironmentLayer } from "./fixture/environment"
import { tempGlobalLayer } from "./fixture/global"
import { tempLocationLayer } from "./fixture/location"
import { testEffect } from "./lib/effect"

const it = testEffect(
  AppNodeBuilder.build(LayerNode.group([node, Bus.node]), [
    [Config.node, Config.testLayer()],
    [Environment.node, hostEnvironmentLayer],
    [Global.node, tempGlobalLayer],
    [Location.node, tempLocationLayer],
  ]),
)

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
  it.live("publishes the created shell PID", () =>
    Effect.gen(function* () {
      const bus = yield* Bus.Service
      const shell = yield* Service
      const eventFiber = yield* bus
        .subscribe(Shell.Event.Created)
        .pipe(Stream.take(1), Stream.runCollect, Effect.forkScoped({ startImmediately: true }))
      const info = yield* shell.create({ command: "exit 0", timeout: 0 })
      const event = Array.from(yield* Fiber.join(eventFiber))[0]

      expect(event?.data.info.id).toBe(info.id)
      expect(typeof event?.data.info.pid).toBe("number")
      expect(event?.data.info.pid).toBe(info.pid)
      yield* shell.wait(info.id)
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
      const shell = "/cygdrive/c/Program Files/Git/bin/bash.exe"
      await withShell(shell, async () => {
        expect(ShellSelect.preferred()).toBe(FSUtil.windowsPath(shell))
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
