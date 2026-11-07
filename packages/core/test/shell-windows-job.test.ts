import { expect } from "bun:test"
import fs from "node:fs/promises"
import path from "node:path"
import { Effect } from "effect"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { Config } from "@opencode/core/config"
import { Environment } from "@opencode/core/environment/index"
import { Location } from "@opencode/core/location"
import { Shell } from "@opencode/core/shell"
import { Global } from "@opencode/util/global"
import { hostEnvironmentLayer } from "./fixture/environment"
import { tempGlobalLayer } from "./fixture/global"
import { tempLocationLayer } from "./fixture/location"
import { tmpdirScoped } from "./fixture/tmpdir"
import { it } from "./lib/effect"

const windows = process.platform === "win32" ? it.live : it.live.skip

// A timeout kills the command from its own fiber while the command's exit releases it. The orphan, whose parent has
// already exited, is only reachable through the command's job.
windows(
  "a timeout ends a process the command left behind",
  () =>
    Effect.gen(function* () {
      const tmp = yield* tmpdirScoped()
      const pidFile = path.join(tmp.path, "orphan.pid")
      yield* Effect.addFinalizer(() =>
        Effect.tryPromise(async () => process.kill(Number(await fs.readFile(pidFile, "utf8")), "SIGKILL")).pipe(
          Effect.ignore,
        ),
      )
      const fixture = path.join(import.meta.dir, "fixture", "orphan.cjs")
      yield* Effect.gen(function* () {
        const shell = yield* Shell.Service
        const info = yield* shell.create({
          shell: "cmd.exe",
          command: `node ${fixture} ${pidFile} exit & ping -n 30 127.0.0.1 >nul`,
          timeout: 2_000,
        })
        expect((yield* shell.result(info)).info.status).toBe("timeout")
      }).pipe(
        Effect.provide(
          AppNodeBuilder.build(Shell.node, [
            Location.node.replace(tempLocationLayer),
            Global.node.replace(tempGlobalLayer),
            Config.node.replace(Config.testLayer()),
            Environment.node.replace(hostEnvironmentLayer),
          ]),
        ),
      )
      const pid = Number(yield* Effect.promise(() => fs.readFile(pidFile, "utf8")))
      expect(yield* Effect.promise(() => gone(pid))).toBe(true)
    }),
  15_000,
)

async function gone(pid: number) {
  const end = Date.now() + 5_000
  while (Date.now() < end) {
    if (!alive(pid)) return true
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  return !alive(pid)
}

function alive(pid: number) {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}
