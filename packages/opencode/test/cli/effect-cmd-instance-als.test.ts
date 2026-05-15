import { afterEach, expect } from "bun:test"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { Effect } from "effect"
import { fileURLToPath } from "url"
import { InstanceRef } from "../../src/effect/instance-ref"
import { disposeAllInstances, TestInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const it = testEffect(AppFileSystem.defaultLayer)

afterEach(async () => {
  await disposeAllInstances()
})

it.live("effect-cmd.ts does not restore legacy instance ALS", () =>
  Effect.gen(function* () {
    const fs = yield* AppFileSystem.Service
    const source = yield* fs.readFileString(fileURLToPath(new URL("../../src/cli/effect-cmd.ts", import.meta.url)))
    expect(source).not.toContain("restore(ctx")
  }),
)

it.instance(
  "InstanceRef remains the handler context across Effect promise awaits",
  () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      const ctx = yield* InstanceRef
      if (!ctx) throw new Error("InstanceRef not provided")

      const directory = yield* Effect.promise(async () => {
        await Promise.resolve()
        return ctx.directory
      })

      expect(directory).toBe(test.directory)
    }),
  { git: true },
)
