import { expect } from "bun:test"
import { chmod, writeFile } from "fs/promises"
import path from "path"
import { Effect, Layer, Sink, Stream } from "effect"
import { ChildProcessSpawner } from "effect/process"
import { ExitCode, makeHandle, ProcessId } from "effect/process/ChildProcessSpawner"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { Config } from "@opencode/core/config"
import { Environment } from "@opencode/core/environment/index"
import { Location } from "@opencode/core/location"
import { PersistentPty } from "@opencode/core/persistent-pty"
import { Shell } from "@opencode/core/shell"
import { Document, Info } from "@opencode/schema/config"
import { ConfigSandbox } from "@opencode/schema/config/sandbox"
import { Global } from "@opencode/util/global"
import { disabledPersistentPtyLayer } from "./fixture/persistent-pty"
import { hostEnvironmentLayer } from "./fixture/environment"
import { tempGlobalLayer } from "./fixture/global"
import { tempLocationLayer } from "./fixture/location"
import { tmpdirScoped } from "./fixture/tmpdir"
import { it } from "./lib/effect"

// With no daemon, commands go through the spawner. That path must be confined exactly like the daemon's.
const run = (
  sandbox: ConstructorParameters<typeof ConfigSandbox.Info>[0],
  body: (shell: Shell.Interface) => Effect.Effect<unknown, unknown, never>,
) =>
  Effect.gen(function* () {
    const spawned: { command: string; args: readonly string[] }[] = []
    const environment = Layer.effect(
      Environment.Service,
      Effect.gen(function* () {
        const host = yield* Environment.Service
        return Environment.Service.of({
          ...host,
          spawner: ChildProcessSpawner.make((command) =>
            Effect.sync(() => {
              const standard = command as unknown as { command: string; args: readonly string[] }
              spawned.push({ command: standard.command, args: standard.args })
              return makeHandle({
                pid: ProcessId(1),
                exitCode: Effect.succeed(ExitCode(0)),
                isRunning: Effect.succeed(false),
                kill: () => Effect.void,
                stdin: Sink.drain,
                stdout: Stream.empty,
                stderr: Stream.empty,
                all: Stream.empty,
                getInputFd: () => Sink.drain,
                getOutputFd: () => Stream.empty,
                unref: Effect.succeed(Effect.void),
              })
            }),
          ),
        })
      }),
    ).pipe(Layer.provide(hostEnvironmentLayer))
    const bin = (yield* tmpdirScoped()).path
    yield* Effect.promise(async () => {
      await writeFile(path.join(bin, "bwrap"), "#!/bin/sh\nexit 0\n")
      await chmod(path.join(bin, "bwrap"), 0o755)
    })
    const previous = process.env.PATH
    process.env.PATH = bin
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        if (previous === undefined) delete process.env.PATH
        else process.env.PATH = previous
      }),
    )
    const exit = yield* Effect.gen(function* () {
      return yield* body(yield* Shell.Service)
    }).pipe(
      Effect.exit,
      Effect.provide(
        AppNodeBuilder.build(Shell.node, [
          Location.node.replace(tempLocationLayer),
          Global.node.replace(tempGlobalLayer),
          Config.node.replace(
            Config.testLayer([
              new Document({ type: "document", info: new Info({ sandbox: new ConfigSandbox.Info(sandbox) }) }),
            ]),
          ),
          Environment.node.replace(environment),
          PersistentPty.node.replace(disabledPersistentPtyLayer),
        ]),
      ),
    )
    return { spawned, exit, bin }
  })

const linux = process.platform === "linux" ? it.live : it.live.skip

linux("wraps the spawner path in bwrap when the daemon is unavailable", () =>
  Effect.gen(function* () {
    const { spawned, exit, bin } = yield* run({ enabled: true }, (shell) =>
      shell.create({ shell: "/bin/sh", command: "echo hi", timeout: 0 }),
    )
    expect(exit._tag).toBe("Success")
    expect(spawned).toHaveLength(1)
    expect(spawned[0]?.command).toBe(path.join(bin, "bwrap"))
    expect(spawned[0]?.args).toContain("--unshare-all")
    expect(spawned[0]?.args.slice(-4)).toEqual(["--", "/bin/sh", "-c", "echo hi"])
  }),
)

linux("runs the spawner path directly when the sandbox is not enabled", () =>
  Effect.gen(function* () {
    const { spawned } = yield* run({ enabled: false }, (shell) =>
      shell.create({ shell: "/bin/sh", command: "echo hi", timeout: 0 }),
    )
    expect(spawned.map((item) => [item.command, item.args])).toEqual([["/bin/sh", ["-c", "echo hi"]]])
  }),
)

linux("fails closed on the spawner path when bwrap is missing", () =>
  Effect.gen(function* () {
    const { spawned, exit } = yield* run({ enabled: true }, (shell) =>
      Effect.gen(function* () {
        process.env.PATH = "/nonexistent"
        return yield* shell.create({ shell: "/bin/sh", command: "touch escaped", timeout: 0 })
      }),
    )
    expect(exit._tag).toBe("Failure")
    expect(spawned).toEqual([])
    expect(JSON.stringify(exit)).toContain("bwrap was not found")
  }),
)
