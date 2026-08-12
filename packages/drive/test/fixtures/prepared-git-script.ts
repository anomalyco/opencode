import { join } from "node:path"
import { defineScript } from "opencode-drive"
import * as Effect from "effect/Effect"

let setupGitError: string | undefined

export default defineScript({
  launch: "manual",
  setup: ({ fs }) =>
    Effect.gen(function* () {
      setupGitError = yield* Effect.matchEffect(
        fs.writeFile(".GIT/config", "setup must not replace Git metadata\n"),
        {
          onFailure: (error) => Effect.succeed(String(error)),
          onSuccess: () => Effect.succeed(undefined),
        },
      )
    }),
  run: ({ artifacts, fs }) =>
    Effect.gen(function* () {
      const runGitError = yield* Effect.matchEffect(
        fs.writeFile(".GIT/config", "run must not replace Git metadata\n"),
        {
          onFailure: (error) => Effect.succeed(String(error)),
          onSuccess: () => Effect.succeed(undefined),
        },
      )
      yield* Effect.tryPromise(() =>
        Bun.write(
          join(artifacts, "prepared-git-result.json"),
          `${JSON.stringify({ runGitError, setupGitError }, undefined, 2)}\n`,
        ),
      )
    }),
})
