import { NodeServices } from "@effect/platform-node"
import { expect, it } from "@effect/vitest"
import { Effect, Exit, Option, Scope } from "effect"
import * as Process from "../../src/instance/process.js"

it.live("does not let an interrupted waiter poison process completion", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const process = yield* Process.spawn([
        globalThis.process.execPath,
        "-e",
        "setTimeout(() => process.exit(0), 100)",
      ])

      const early = yield* process.exitCode.pipe(Effect.timeoutOption(5))
      expect(Option.isNone(early)).toBe(true)
      expect(yield* process.exitCode).toBe(0)
    }),
  ).pipe(Effect.provide(NodeServices.layer)),
)

it.live("collects finite command output and status", () =>
  Process.run([
    globalThis.process.execPath,
    "-e",
    'console.log("stdout"); console.error("stderr")',
  ]).pipe(
    Effect.provide(NodeServices.layer),
    Effect.tap((output) =>
      Effect.sync(() => {
        expect(output).toEqual({
          status: 0,
          stdout: "stdout\n",
          stderr: "stderr\n",
        })
      }),
    ),
  ),
)

it.live("keeps exit observation alive after detachment", () =>
  Effect.gen(function* () {
    const scope = yield* Scope.make()
    const process = yield* Process.spawn([
      globalThis.process.execPath,
      "-e",
      "setTimeout(() => process.exit(7), 100)",
    ]).pipe(Scope.provide(scope))

    yield* process.detach
    yield* Scope.close(scope, Exit.void)
    expect(yield* process.exitCode).toBe(7)
  }).pipe(Effect.provide(NodeServices.layer)),
)
