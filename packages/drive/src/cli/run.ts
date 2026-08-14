import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import * as Effect from "effect/Effect"
import * as Process from "../instance/process.js"
import { prepareProgram } from "../script/tooling.js"

export const runProgram = Effect.fn("Cli.runProgram")((file: string) =>
  Effect.acquireUseRelease(
    Effect.tryPromise({
      try: () => mkdtemp(join(tmpdir(), "opencode-drive-run-")),
      catch: (cause) => cause,
    }),
    (artifacts) =>
      Effect.gen(function* () {
        const runner = yield* Effect.tryPromise({
          try: () => prepareProgram(artifacts, resolve(file)),
          catch: (cause) => cause,
        })
        const result = yield* Process.run([process.execPath, runner], {
          extendEnv: true,
          stdin: "inherit",
          stdout: "inherit",
          stderr: "inherit",
        })
        if (result.status !== 0) return yield* Effect.fail(new Error(`program exited with status ${result.status}`))
        return undefined
      }),
    (artifacts) => Effect.promise(() => rm(artifacts, { recursive: true, force: true })),
  ),
)
