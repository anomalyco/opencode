import { NodeFileSystem } from "@effect/platform-node"
import { Global } from "@opencode-ai/util/global"
import { AppProcess } from "@opencode-ai/util/process"
import { Effect, FileSystem, Layer, Stream } from "effect"
import { ChildProcessSpawner } from "effect/unstable/process"
import assert from "node:assert/strict"
import path from "node:path"
import { Updater } from "../updater"

const latest = { version: "0.0.0-beta-17498" }
const installs: string[] = []

// This fixture runs in its own process; no real update requests or installs occur.
globalThis.fetch = Object.assign(async () => Response.json(latest), { preconnect() {} })

await Effect.runPromise(
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const directory = yield* fs.makeTempDirectoryScoped({ prefix: "opencode-updater-" })
    const dependencies = Layer.mergeAll(
      Layer.succeed(FileSystem.FileSystem, fs),
      Layer.succeed(
        Global.Service,
        Global.make({ home: directory, config: directory, cache: path.join(directory, "cache") }),
      ),
      Layer.succeed(AppProcess.Service, {
        ...ChildProcessSpawner.make(() => Effect.die("Unexpected process spawn")),
        runStream: () => Stream.die("Unexpected streaming process"),
        run: (command) => {
          assert.equal(command._tag, "StandardCommand")
          if (command.command === "npm" && command.args[0] === "install") {
            assert.ok(command.args.includes("--global"))
            installs.push(command.args.at(-1)!)
          }
          return Effect.succeed({
            command: command.command,
            exitCode: 0,
            stdout: Buffer.from(command.command === "npm" ? "@opencode-ai/cli" : ""),
            stderr: Buffer.alloc(0),
            stdoutTruncated: false,
            stderrTruncated: false,
          })
        },
      }),
    )
    yield* Effect.gen(function* () {
      const updater = yield* Updater.Service
      yield* updater.check()
      assert.deepEqual(installs, ["@opencode-ai/cli@0.0.0-beta-17498"])
      yield* updater.check()
      yield* updater.check()
      assert.deepEqual(installs, ["@opencode-ai/cli@0.0.0-beta-17498"])
      latest.version = "0.0.0-beta-17499"
      yield* updater.check()
      assert.deepEqual(installs, ["@opencode-ai/cli@0.0.0-beta-17498", "@opencode-ai/cli@0.0.0-beta-17499"])
    }).pipe(Effect.provide(Updater.layer.pipe(Layer.provide(dependencies))))
  }).pipe(Effect.scoped, Effect.provide(NodeFileSystem.layer)),
)
