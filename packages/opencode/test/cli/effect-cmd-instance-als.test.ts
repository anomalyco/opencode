import { afterEach, expect, test } from "bun:test"
import { Effect } from "effect"
import { Instance } from "../../src/project/instance"
import { disposeAllInstances, provideTestInstance, tmpdir } from "../fixture/fixture"

afterEach(async () => {
  await disposeAllInstances()
})

// Regression for PR #25522: when an effectCmd handler does
// `yield* Effect.promise(async () => { ... await runPromise(svcMethod) ... })`,
// the inner runPromise creates a fresh fiber after `await` whose Effect context
// has lost the outer InstanceRef. Services that read `InstanceState.context`
// then fall back to `Instance.current` ALS, which must be installed at the JS
// callback boundary (Node ALS persists across awaits, Effect's fiber context
// does not). `provideTestInstance` mirrors effectCmd's load + ALS-restore wrap.
test("Instance.current reachable from inner runPromise inside Effect.promise(async)", async () => {
  await using dir = await tmpdir({ git: true })
  await provideTestInstance({
    directory: dir.path,
    fn: () =>
      Effect.runPromise(
        Effect.promise(async () => {
          await new Promise((r) => setTimeout(r, 5))
          const current = await Effect.runPromise(
            Effect.sync(() => {
              try {
                return Instance.current
              } catch {
                return undefined
              }
            }),
          )
          expect(current?.directory).toBe(dir.path)
        }),
      ),
  })
})
