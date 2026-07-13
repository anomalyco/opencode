import { expect } from "bun:test"
import { ProcessLock } from "@opencode-ai/core/util/process-lock"
import { Effect } from "effect"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { it } from "../lib/effect"

const worker = path.join(import.meta.dir, "../fixture/process-lock-worker.ts")

it.live(
  "releases ownership when the scope closes",
  Effect.gen(function* () {
    const root = yield* temp("opencode-process-lock-")
    const file = path.join(root, "service.lock")
    yield* Effect.scoped(ProcessLock.acquire(file))
    yield* Effect.scoped(ProcessLock.acquire(file))
  }),
)

it.live(
  "releases ownership when the process dies",
  Effect.gen(function* () {
    const root = yield* temp("opencode-process-lock-death-")
    const file = path.join(root, "service.lock")
    const ready = path.join(root, "ready")
    const child = yield* Effect.acquireRelease(
      Effect.sync(() =>
        Bun.spawn([process.execPath, worker, JSON.stringify({ file, ready })], {
          stdout: "ignore",
          stderr: "pipe",
        }),
      ),
      (child) =>
        Effect.promise(async () => {
          kill(child)
          await child.exited
        }),
    )
    yield* Effect.promise(async () => {
      for (let attempt = 0; attempt < 100 && !(await Bun.file(ready).exists()); attempt++) await Bun.sleep(20)
    })
    expect(yield* Effect.promise(() => Bun.file(ready).exists())).toBe(true)

    const error = yield* Effect.scoped(ProcessLock.acquire(file)).pipe(Effect.flip)
    expect(error._tag).toBe("ProcessLockHeldError")

    if (process.platform !== "win32") {
      process.kill(child.pid, "SIGSTOP")
      const paused = yield* Effect.scoped(ProcessLock.acquire(file)).pipe(Effect.flip)
      expect(paused._tag).toBe("ProcessLockHeldError")
      process.kill(child.pid, "SIGCONT")
    }

    kill(child)
    yield* Effect.promise(() => child.exited)
    yield* Effect.scoped(ProcessLock.acquire(file))
  }),
)

function temp(prefix: string) {
  return Effect.acquireRelease(
    Effect.promise(() => fs.mkdtemp(path.join(os.tmpdir(), prefix))),
    (root) => Effect.promise(() => fs.rm(root, { recursive: true, force: true })),
  )
}

function kill(child: Bun.Subprocess) {
  if (process.platform === "win32") return child.kill()
  return child.kill("SIGKILL")
}
