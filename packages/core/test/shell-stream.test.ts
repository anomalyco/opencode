import { expect } from "bun:test"
import { Deferred, Effect, Exit } from "effect"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { Config } from "@opencode/core/config"
import { Environment } from "@opencode/core/environment/index"
import { Location } from "@opencode/core/location"
import { Shell } from "@opencode/core/shell"
import { Global } from "@opencode/util/global"
import { hostEnvironmentLayer } from "./fixture/environment"
import { tempGlobalLayer } from "./fixture/global"
import { tempLocationLayer } from "./fixture/location"
import { testEffect } from "./lib/effect"

const it = testEffect(
  AppNodeBuilder.build(Shell.node, [
    Location.node.replace(tempLocationLayer),
    Global.node.replace(tempGlobalLayer),
    Config.node.replace(Config.testLayer()),
    Environment.node.replace(hostEnvironmentLayer),
  ]),
)

const posix = process.platform === "win32" ? it.live.skip : it.live

posix("observes fast stdout separately and preserves stderr in the log", () =>
  Effect.gen(function* () {
    const shell = yield* Shell.Service
    const chunks: Uint8Array[] = []
    const info = yield* shell.create(
      { shell: "/bin/sh", command: "printf 'event\\n'; printf 'diagnostic\\n' >&2; exit 7" },
      undefined,
      { stdout: (chunk) => chunks.push(chunk) },
    )
    const result = yield* shell.wait(info.id)
    expect(result).toMatchObject({ status: "exited", exit: 7 })
    expect(Buffer.concat(chunks).toString()).toBe("event\n")
    const log = yield* Effect.promise(() => Bun.file(info.file).text())
    expect(log).toContain("event\n")
    expect(log).toContain("diagnostic\n")
  }),
)

posix("caps the saved log without dropping observed stdout", () =>
  Effect.gen(function* () {
    const shell = yield* Shell.Service
    const chunks: Uint8Array[] = []
    const info = yield* shell.create(
      { shell: "/bin/sh", command: "printf 'abcdefghij\\n'; printf 'stderr\\n' >&2" },
      undefined,
      { stdout: (chunk) => chunks.push(chunk), maxBytes: 5 },
    )
    yield* shell.wait(info.id)
    expect(Buffer.concat(chunks).toString()).toBe("abcdefghij\n")
    expect((yield* Effect.promise(() => Bun.file(info.file).arrayBuffer())).byteLength).toBe(5)
    expect((yield* shell.output(info.id)).size).toBe(5)
  }),
)

posix("caller-owned monitor output survives removal from the shell inventory", () =>
  Effect.gen(function* () {
    const shell = yield* Shell.Service
    const info = yield* shell.create({ shell: "/bin/sh", command: "printf 'finished\\n'" }, undefined, {
      retainOutput: true,
    })
    yield* shell.wait(info.id)
    yield* shell.remove(info.id)
    expect(Exit.isFailure(yield* shell.get(info.id).pipe(Effect.exit))).toBe(true)
    expect(yield* Effect.promise(() => Bun.file(info.file).text())).toBe("finished\n")
    expect(info.file.split("/").at(-1)).toStartWith("monitor-")
  }),
)

for (const reason of ["deadline", "stop"] as const) {
  posix(`${reason} kills the saved process group and keeps its log`, () =>
    Effect.gen(function* () {
      const shell = yield* Shell.Service
      const ready = yield* Deferred.make<number>()
      let output = ""
      const info = yield* shell.create(
        {
          shell: "/bin/sh",
          // Both shells handle TERM so the parent reaps its child before exiting.
          command: `mkfifo monitor-wait; trap 'wait; exit' TERM; sh -c 'exec 3<>monitor-wait; trap "exit" TERM; printf "%s\\n" "$$"; read token <&3' & wait`,
        },
        undefined,
        {
          stdout: (chunk) => {
            output += Buffer.from(chunk).toString()
            if (output.includes("\n")) Deferred.doneUnsafe(ready, Exit.succeed(Number(output.trim())))
          },
          maxBytes: 1_024,
        },
      )
      yield* Effect.addFinalizer(() => shell.stop(info.id).pipe(Effect.ignore))
      const child = yield* Deferred.await(ready).pipe(Effect.timeout("5 seconds"))
      expect(child).toBeGreaterThan(0)
      if (reason === "deadline") yield* shell.timeout(info.id, 1)
      if (reason === "stop") yield* shell.stop(info.id)
      const result = yield* shell.wait(info.id).pipe(Effect.timeout("5 seconds"))
      expect(result.status).toBe(reason === "deadline" ? "timeout" : "killed")
      expect(() => process.kill(child, 0)).toThrow()
      expect(() => process.kill(info.pid!, 0)).toThrow()
      expect(yield* Effect.promise(() => Bun.file(info.file).text())).toContain(String(child))
    }),
  )
}

const linux = process.platform === "linux" ? it.live : it.live.skip

for (const reason of ["deadline", "exit"] as const) {
  linux(`forced ${reason} cleanup kills descendants that ignore TERM and close their output`, () =>
    Effect.gen(function* () {
      const shell = yield* Shell.Service
      const ready = yield* Deferred.make<number>()
      let output = ""
      const info = yield* shell.create(
        {
          shell: "/bin/sh",
          command: `mkfifo monitor-wait; sh -c 'exec 3<>monitor-wait; trap "" TERM; printf "%s\\n" "$$"; exec >/dev/null 2>&1; read token <&3' & ${reason === "deadline" ? "wait" : "exit 0"}`,
        },
        undefined,
        {
          stdout: (chunk) => {
            output += Buffer.from(chunk).toString()
            if (output.includes("\n")) Deferred.doneUnsafe(ready, Exit.succeed(Number(output.trim())))
          },
          maxBytes: 1_024,
          forceKill: true,
        },
      )
      yield* Effect.addFinalizer(() => shell.stop(info.id).pipe(Effect.ignore))
      const child = yield* Deferred.await(ready).pipe(Effect.timeout("5 seconds"))
      expect(child).toBeGreaterThan(0)
      if (reason === "deadline") yield* shell.timeout(info.id, 1)
      const result = yield* shell.wait(info.id).pipe(Effect.timeout("5 seconds"))
      expect(result.status).toBe(reason === "deadline" ? "timeout" : "exited")
      // Containers may defer reaping an orphaned zombie; neither dead state can execute work.
      const stat = yield* Effect.tryPromise(() => Bun.file(`/proc/${child}/stat`).text()).pipe(
        Effect.orElseSucceed(() => undefined),
      )
      expect(stat === undefined || /\) [ZX] /.test(stat)).toBe(true)
    }),
  )
}
