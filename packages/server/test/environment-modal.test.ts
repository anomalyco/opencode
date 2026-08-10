import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterAll, expect, test } from "bun:test"
import { Effect } from "effect"
import { ChildProcess } from "effect/unstable/process"
import { Failed, makeFiles } from "@opencode-ai/core/environment"
import { environmentConformance } from "@opencode-ai/core/testing/environment-conformance"
import { createModalSandbox } from "../src/workspace/modal"

const enabled =
  !!process.env.OPENCODE_TEST_MODAL &&
  ((!!process.env.MODAL_TOKEN_ID && !!process.env.MODAL_TOKEN_SECRET) ||
    fs.existsSync(path.join(os.homedir(), ".modal.toml")))
const modalTest = enabled ? test : test.skip
const root = `/tmp/opencode-environment-${crypto.randomUUID()}`
const sandbox = enabled
  ? createModalSandbox({
      app: "opencode-environment-tests",
      sandbox: { timeoutMs: 10 * 60 * 1000 },
    })
  : undefined

modalTest(
  "kills a running modal process",
  async () => {
    const value = await sandbox!
    const started = performance.now()
    const exitCode = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const handle = yield* value.driver.spawner.spawn(ChildProcess.make("sleep", ["300"]))
          yield* handle.kill()
          return yield* handle.exitCode
        }),
      ).pipe(Effect.timeout("10 seconds")),
    )
    expect(exitCode).not.toBe(0)
    expect(performance.now() - started).toBeLessThan(10_000)
  },
  15_000,
)

environmentConformance(
  "modal environment",
  () =>
    Effect.promise(async () => {
      const value = await sandbox!
      return {
        files: makeFiles(value.driver),
        root,
        symlink: (target, link) =>
          Effect.scoped(value.driver.spawner.exitCode(ChildProcess.make("ln", ["-s", "--", target, link]))).pipe(
            Effect.flatMap((code) =>
              code === 0 ? Effect.void : Effect.fail(new Failed({ path: link, cause: new Error(`ln exited ${code}`) })),
            ),
            Effect.mapError((cause) => (cause instanceof Failed ? cause : new Failed({ path: link, cause }))),
          ),
      }
    }),
  !enabled,
)

afterAll(async () => {
  if (!sandbox) return
  await (await sandbox).terminate()
})
