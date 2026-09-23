import { expect } from "bun:test"
import { spawn } from "node:child_process"
import path from "node:path"
import { Effect } from "effect"
import { it } from "../lib/effect"

const windowsTest = process.platform === "win32" ? it.live : it.live.skip

Array.of("interrupt", "raw").forEach((scenario) => {
  windowsTest(
    scenario === "interrupt"
      ? "detached PTY hosts interrupt commands without closing the shell"
      : "detached PTY hosts preserve Ctrl+C input for raw-mode programs",
    Effect.gen(function* () {
      // Isolate the inheritable Windows console state from the test runner.
      const worker = yield* Effect.acquireRelease(
        Effect.sync(() => {
          const child = spawn(process.execPath, [path.join(import.meta.dir, "../fixture/pty-windows.ts"), scenario], {
            detached: true,
            stdio: ["ignore", "ignore", "pipe"],
            timeout: 30_000,
          })
          const output: string[] = []
          child.stderr.on("data", (chunk: Buffer) => output.push(chunk.toString()))
          const exited = new Promise<number | null>((resolve, reject) => {
            child.once("error", reject)
            child.once("close", resolve)
          })
          return { child, output, exited }
        }),
        (worker) =>
          Effect.sync(() => {
            if (worker.child.exitCode === null && worker.child.signalCode === null) worker.child.kill()
          }),
      )
      const code = yield* Effect.promise(() => worker.exited)
      expect({ code, output: worker.output.join("") }).toEqual({ code: 0, output: "" })
    }),
    35_000,
  )
})
