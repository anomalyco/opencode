import * as NodeServices from "@effect/platform-node/NodeServices"
import * as Effect from "effect/Effect"
import * as Process from "../instance/process.js"

export const ffmpeg = Effect.fn("Recording.ffmpeg")(function* (command: string, args: string[]) {
  const output = yield* Process.run([command, ...args], {
    stdout: "ignore",
    stderrLimit: 16_384,
  })
  if (output.status !== 0)
    return yield* Effect.fail(new Error(`ffmpeg exited with code ${output.status}: ${output.stderr.trim()}`))
  return undefined
})

export function runFfmpeg(command: string, args: string[], signal?: AbortSignal) {
  return Effect.runPromise(ffmpeg(command, args).pipe(Effect.provide(NodeServices.layer)), { signal }).then(
    () => {
      if (signal?.aborted) throw signal.reason ?? new Error("recording export aborted")
    },
    (cause) => {
      throw signal?.aborted ? (signal.reason ?? new Error("recording export aborted")) : cause
    },
  )
}
