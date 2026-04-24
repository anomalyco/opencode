import fs from "fs/promises"
import path from "path"
import { describe, expect, test } from "bun:test"
import { Effect, Layer, Stream } from "effect"
import { NodeFileSystem } from "@effect/platform-node"
import { AppFileSystem } from "@opencode-ai/shared/filesystem"
import { Global } from "@opencode-ai/shared/global"
import { EffectFlock } from "@opencode-ai/shared/util/effect-flock"
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process"
import { Npm } from "../src/npm"
import { tmpdir } from "./fixture/fixture"

const win = process.platform === "win32"
const encoder = new TextEncoder()
function mockSpawner(handler: (cmd: string, args: readonly string[]) => string = () => "") {
  const spawner = ChildProcessSpawner.make((command) => {
    const std = ChildProcess.isStandardCommand(command) ? command : undefined
    const output = handler(std?.command ?? "", std?.args ?? [])
    return Effect.succeed(
      ChildProcessSpawner.makeHandle({
        pid: ChildProcessSpawner.ProcessId(0),
        exitCode: Effect.succeed(ChildProcessSpawner.ExitCode(0)),
        isRunning: Effect.succeed(false),
        kill: () => Effect.void,
        stdin: { [Symbol.for("effect/Sink/TypeId")]: Symbol.for("effect/Sink/TypeId") } as any,
        stdout: output ? Stream.make(encoder.encode(output)) : Stream.empty,
        stderr: Stream.empty,
        all: Stream.empty,
        getInputFd: () => ({ [Symbol.for("effect/Sink/TypeId")]: Symbol.for("effect/Sink/TypeId") }) as any,
        getOutputFd: () => Stream.empty,
        unref: Effect.succeed(Effect.void),
      }),
    )
  })
  return Layer.succeed(ChildProcessSpawner.ChildProcessSpawner, spawner)
}

function testLayer(spawnHandler?: (cmd: string, args: readonly string[]) => string) {
  return Npm.layer.pipe(
    Layer.provide(mockSpawner(spawnHandler)),
    Layer.provide(EffectFlock.layer),
    Layer.provide(AppFileSystem.layer),
    Layer.provide(Global.layer),
    Layer.provide(NodeFileSystem.layer),
  )
}

const writePackage = (dir: string, pkg: Record<string, unknown>) =>
  Bun.write(
    path.join(dir, "package.json"),
    JSON.stringify({
      version: "1.0.0",
      ...pkg,
    }),
  )

describe("Npm.sanitize", () => {
  test("keeps normal scoped package specs unchanged", () => {
    expect(Npm.sanitize("@opencode/acme")).toBe("@opencode/acme")
    expect(Npm.sanitize("@opencode/acme@1.0.0")).toBe("@opencode/acme@1.0.0")
    expect(Npm.sanitize("prettier")).toBe("prettier")
  })

  test("handles git https specs", () => {
    const spec = "acme@git+https://github.com/opencode/acme.git"
    const expected = win ? "acme@git+https_//github.com/opencode/acme.git" : spec
    expect(Npm.sanitize(spec)).toBe(expected)
  })
})

describe("Npm.install", () => {
  test("respects omit from project .npmrc", async () => {
    await using tmp = await tmpdir()

    await writePackage(tmp.path, {
      name: "fixture",
      dependencies: {
        "prod-pkg": "file:./prod-pkg",
      },
      devDependencies: {
        "dev-pkg": "file:./dev-pkg",
      },
    })
    await Bun.write(path.join(tmp.path, ".npmrc"), "omit=dev\n")
    await fs.mkdir(path.join(tmp.path, "prod-pkg"))
    await fs.mkdir(path.join(tmp.path, "dev-pkg"))
    await writePackage(path.join(tmp.path, "prod-pkg"), { name: "prod-pkg" })
    await writePackage(path.join(tmp.path, "dev-pkg"), { name: "dev-pkg" })

    await Npm.install(tmp.path)

    await expect(fs.stat(path.join(tmp.path, "node_modules", "prod-pkg"))).resolves.toBeDefined()
    await expect(fs.stat(path.join(tmp.path, "node_modules", "dev-pkg"))).rejects.toThrow()
  })
})

describe("Npm.outdated", () => {
  test("checks latest via npm view", async () => {
    const calls: string[][] = []
    const layer = testLayer((cmd, args) => {
      calls.push([cmd, ...args])
      if (cmd === "npm" && args[0] === "view") return '"2.0.0"\n'
      return ""
    })

    const result = await Effect.runPromise(
      Npm.Service.use((svc) => svc.outdated("example", "1.0.0")).pipe(Effect.provide(layer)),
    )

    expect(result).toBe(true)
    expect(calls).toContainEqual(["npm", "view", "example", "dist-tags.latest", "--json"])
  })

  test("keeps range comparison behavior", async () => {
    const layer = testLayer((cmd, args) => {
      if (cmd === "npm" && args[0] === "view") return '"2.3.0"\n'
      return ""
    })

    const result = await Effect.runPromise(
      Npm.Service.use((svc) => svc.outdated("example", "^2.0.0")).pipe(Effect.provide(layer)),
    )

    expect(result).toBe(false)
  })

  test("falls back when npm view is unavailable", async () => {
    const calls: string[][] = []
    const layer = testLayer((cmd, args) => {
      calls.push([cmd, ...args])
      if (cmd === "pnpm" && args[0] === "view") return '"2.0.0"\n'
      return ""
    })

    const result = await Effect.runPromise(
      Npm.Service.use((svc) => svc.outdated("example", "1.0.0")).pipe(Effect.provide(layer)),
    )

    expect(result).toBe(true)
    expect(calls).toContainEqual(["npm", "view", "example", "dist-tags.latest", "--json"])
    expect(calls).toContainEqual(["pnpm", "view", "example", "dist-tags.latest", "--json"])
  })
})
