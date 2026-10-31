import { expect, test } from "bun:test"
import { NodeFileSystem } from "@effect/platform-node"
import { Effect, Layer, Logger } from "effect"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { Logging } from "../src/observability/logging.js"

test("file logger preserves shared objects and marks only ancestor cycles", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-log-test-"))
  await using _ = {
    async [Symbol.asyncDispose]() {
      await fs.rm(dir, { recursive: true, force: true })
    },
  }
  const shared = { value: 42 }
  const empty = {}
  const cycle: { value: number; self?: unknown } = { value: 7 }
  cycle.self = cycle
  const file = path.join(dir, "opencode.log")

  await Effect.logInfo({ first: shared, second: shared, emptyFirst: empty, emptySecond: empty, cycle }).pipe(
    Effect.provide(
      Logger.layer([Logging.fileLogger(file, "test")]).pipe(Layer.provide(NodeFileSystem.layer), Layer.orDie),
    ),
    Effect.scoped,
    Effect.runPromise,
  )

  const line = await Bun.file(file).text()
  expect(line).toContain("first.value=42")
  expect(line).toContain("second.value=42")
  expect(line).toContain("emptyFirst={}")
  expect(line).toContain("emptySecond={}")
  expect(line).toContain("cycle.value=7")
  expect(line).toContain("cycle.self=[Circular]")
})
