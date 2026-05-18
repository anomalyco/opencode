import { describe, expect } from "bun:test"
import { memoMap } from "@opencode-ai/core/effect/memo-map"
import { Effect, Exit, Layer, Scope } from "effect"
import { HttpRouter } from "effect/unstable/http"
import { AppRuntime } from "../../src/effect/app-runtime"
import { listenerLayer } from "../../src/server/server"
import { SessionRunState } from "../../src/session/run-state"
import { it } from "../lib/effect"

describe("HttpApi listener MemoMap", () => {
  it.live("shares SessionRunState with the in-process AppRuntime", () =>
    Effect.gen(function* () {
      const captured: { listener?: SessionRunState.Interface } = {}
      const fromAppRuntime = yield* Effect.promise(() =>
        AppRuntime.runPromise(SessionRunState.Service.use((svc) => Effect.succeed(svc))),
      )
      const scope = yield* Scope.make()
      yield* Effect.addFinalizer(() => Scope.close(scope, Exit.void).pipe(Effect.ignore))

      yield* Layer.buildWithMemoMap(
        listenerLayer({ hostname: "127.0.0.1", port: 0 }, 0, [
          HttpRouter.use(() =>
            Effect.gen(function* () {
              captured.listener = yield* SessionRunState.Service
            }),
          ),
        ]),
        memoMap,
        scope,
      )

      expect(captured.listener).toBe(fromAppRuntime)
    }),
  )
})
