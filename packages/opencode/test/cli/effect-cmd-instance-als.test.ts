import { afterEach, expect } from "bun:test"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { Effect } from "effect"
import { fileURLToPath } from "url"
import { InstanceRef } from "../../src/effect/instance-ref"
import { Instance } from "../../src/project/instance"
import { disposeAllInstances, TestInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const it = testEffect(AppFileSystem.defaultLayer)

afterEach(async () => {
  await disposeAllInstances()
})

// Regression for PR #25522: when an effectCmd handler does
// `yield* Effect.promise(async () => { ... await runPromise(svcMethod) ... })`,
// the inner runPromise creates a fresh fiber after `await` whose Effect context
// has lost the outer InstanceRef. Services that read `InstanceState.context`
// then fall back to `Instance.current` ALS, which must be installed at the JS
// callback boundary (Node ALS persists across awaits, Effect's fiber context
// does not). `it.instance` provides the loaded InstanceRef; the explicit
// Instance.restore mirrors effectCmd's load + ALS-restore wrap.
// Pins effect-cmd.ts directly: the pattern test below exercises the load +
// Instance.restore boundary via the shared `it.instance` fixture,
// so a regression that removed `Instance.restore` from effect-cmd.ts wouldn't
// fail it. This grep guards the actual production callsite.
it.live("effect-cmd.ts wraps the handler body in Instance.restore", () =>
  Effect.gen(function* () {
    const fs = yield* AppFileSystem.Service
    const source = yield* fs.readFileString(fileURLToPath(new URL("../../src/cli/effect-cmd.ts", import.meta.url)))
    expect(source).toContain("Instance.restore(ctx")
  }),
)

it.instance(
  "Instance.current reachable after await inside restored Effect.promise(async)",
  () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      const ctx = yield* InstanceRef
      if (!ctx) throw new Error("InstanceRef not provided")

      const current = yield* Effect.promise(() =>
        Instance.restore(ctx, async () => {
          await Promise.resolve()
          try {
            return Instance.current
          } catch {
            return undefined
          }
        }),
      )

      expect(current?.directory).toBe(test.directory)
    }),
  { git: true },
)
